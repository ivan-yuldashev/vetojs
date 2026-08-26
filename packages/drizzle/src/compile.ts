import {
	type ConditionNode,
	ConditionOperator,
	MatchQuantifier,
	RelationKind,
} from "@vetojs/core";
import {
	and,
	arrayContains,
	arrayOverlaps,
	type Column,
	eq,
	exists,
	getTableColumns,
	getTableName,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	notExists,
	or,
	type SQL,
	sql,
	type Table,
} from "drizzle-orm";
import { alias, type PgTable, QueryBuilder } from "drizzle-orm/pg-core";
import { own } from "./own.js";

const TRUE = sql`true`;
const FALSE = sql`false`;
const unknownWhenPresent = (column: Column): SQL =>
	sql`case when ${column} is null then false else null::boolean end`;

const totalize = (predicate: SQL): SQL => sql`coalesce(${predicate}, false)`;

const UNKNOWN = sql`null::boolean`;

const NAN_CAPABLE = /^(numeric|decimal|real|double precision|float)/;

const holdsNaN = (column: Column): boolean =>
	NAN_CAPABLE.test(column.getSQLType());

const unknownOnNaN = (column: Column, predicate: SQL): SQL =>
	holdsNaN(column)
		? sql`case when ${column} = 'NaN' then null::boolean else ${predicate} end`
		: predicate;

const unusable = (value: unknown): boolean => {
	if (typeof value === "number") {
		return Number.isNaN(value);
	}

	return value instanceof Date && Number.isNaN(value.getTime());
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const columnValue = (column: Column, value: unknown): unknown => {
	return column.dataType === "date" && typeof value === "number"
		? new Date(value)
		: value;
};

const SCALAR_TYPES: readonly string[] = [
	"string",
	"number",
	"boolean",
	"bigint",
];

const NUMERIC_TYPES: readonly string[] = ["number", "bigint"];

const ORDERING: readonly ConditionOperator[] = [
	ConditionOperator.GreaterThan,
	ConditionOperator.GreaterThanOrEqual,
	ConditionOperator.LessThan,
	ConditionOperator.LessThanOrEqual,
];

const ORDERABLE_TYPES: readonly string[] = [
	"string",
	"number",
	"bigint",
	"date",
	"custom",
];

const TEXTUAL_TYPES: readonly string[] = ["string", "custom"];

const isScalar = (value: unknown): boolean => {
	return (
		value === null ||
		SCALAR_TYPES.includes(typeof value) ||
		value instanceof Date
	);
};

const typeMatches = (column: Column, value: unknown): boolean => {
	switch (column.dataType) {
		case "string":
			return typeof value === "string";
		case "number":
		case "bigint":
			return NUMERIC_TYPES.includes(typeof value);
		case "boolean":
			return typeof value === "boolean";
		case "date":
			return value instanceof Date;
		default:
			return true;
	}
};

const answersUnknown = (
	column: Column,
	op: ConditionOperator,
	scalar: unknown,
): boolean => {
	if (unusable(scalar)) {
		return ORDERING.includes(op);
	}

	if (ORDERING.includes(op)) {
		return (
			!ORDERABLE_TYPES.includes(column.dataType) || !typeMatches(column, scalar)
		);
	}

	if (op === ConditionOperator.Contains) {
		return (
			typeof scalar === "string" && !TEXTUAL_TYPES.includes(column.dataType)
		);
	}

	return false;
};

const scalarOrThrow = (
	column: Column,
	value: unknown,
	op: ConditionOperator,
): unknown => {
	if (!isScalar(value)) {
		throw new Error(
			`@vetojs/drizzle: operator "${op}" on column "${column.name}" got a non-scalar value — objects have no SQL comparison; fix the rule's value.`,
		);
	}

	return columnValue(column, value);
};

const membersOrThrow = (
	column: Column,
	value: unknown,
	op: ConditionOperator,
): unknown[] => {
	if (!Array.isArray(value)) {
		throw new Error(
			`@vetojs/drizzle: operator "${op}" on column "${column.name}" requires an array value in the rule — received ${typeof value}. parseRules rejects such rules; fix the hand-built one.`,
		);
	}

	return value.map((member) => scalarOrThrow(column, member, op));
};

const arrayMembership = (
	column: Column,
	raw: unknown,
	op: ConditionOperator,
): SQL => {
	const members = membersOrThrow(
		column,
		op === ConditionOperator.Has ? [raw] : raw,
		op,
	);

	if (members.some((member) => member === null)) {
		throw new Error(
			`@vetojs/drizzle: operator "${op}" on column "${column.name}" got a null member — array membership against NULL has no honest SQL form.`,
		);
	}

	if (members.some(unusable)) {
		return FALSE;
	}

	if (members.length === 0) {
		return op === ConditionOperator.HasAll ? isNotNull(column) : FALSE;
	}

	return op === ConditionOperator.HasAny
		? totalize(arrayOverlaps(column, members))
		: totalize(arrayContains(column, members));
};

const membership = (
	column: Column,
	raw: unknown,
	op: ConditionOperator,
): SQL => {
	const members = membersOrThrow(column, raw, op);

	const present = members.filter(
		(member) =>
			member !== null && typeMatches(column, member) && !unusable(member),
	);

	const hasNull = members.some((member) => member === null);
	const parts: SQL[] = [];

	if (present.length > 0) {
		parts.push(totalize(inArray(column, present)));
	}

	if (hasNull) {
		parts.push(isNull(column));
	}

	return parts.length === 0 ? FALSE : (or(...parts) ?? FALSE);
};

const nullSafeEqual = (column: Column, scalar: unknown): SQL => {
	if (scalar === null) {
		return isNull(column);
	}

	return column.notNull
		? eq(column, scalar)
		: sql`${column} is not distinct from ${sql.param(scalar, column)}`;
};

const nullSafeNotEqual = (column: Column, scalar: unknown): SQL => {
	if (scalar === null) {
		return isNotNull(column);
	}

	return column.notNull
		? ne(column, scalar)
		: sql`${column} is distinct from ${sql.param(scalar, column)}`;
};

type ScalarComparison = (column: Column, scalar: unknown) => SQL;

const SCALAR_COMPARISONS: Record<
	Exclude<
		ConditionOperator,
		| typeof ConditionOperator.Exists
		| typeof ConditionOperator.In
		| typeof ConditionOperator.NotIn
		| typeof ConditionOperator.Has
		| typeof ConditionOperator.HasAny
		| typeof ConditionOperator.HasAll
	>,
	ScalarComparison
> = {
	[ConditionOperator.Equal]: nullSafeEqual,
	[ConditionOperator.NotEqual]: nullSafeNotEqual,
	[ConditionOperator.GreaterThan]: (column, scalar) =>
		totalize(gt(column, scalar)),
	[ConditionOperator.GreaterThanOrEqual]: (column, scalar) =>
		totalize(gte(column, scalar)),
	[ConditionOperator.LessThan]: (column, scalar) =>
		totalize(lt(column, scalar)),
	[ConditionOperator.LessThanOrEqual]: (column, scalar) =>
		totalize(lte(column, scalar)),
	[ConditionOperator.Contains]: (column, scalar) =>
		typeof scalar === "string"
			? totalize(like(column, `%${escapeLike(scalar)}%`))
			: FALSE,
};

const compileField = (
	column: Column,
	op: ConditionOperator,
	value: unknown,
): SQL => {
	if (op === ConditionOperator.Exists) {
		if (typeof value !== "boolean") {
			return UNKNOWN;
		}

		return value ? isNotNull(column) : isNull(column);
	}

	if (op === ConditionOperator.In) {
		return membership(column, value, op);
	}

	if (op === ConditionOperator.NotIn) {
		return not(membership(column, value, op));
	}

	if (
		op === ConditionOperator.Has ||
		op === ConditionOperator.HasAny ||
		op === ConditionOperator.HasAll
	) {
		return arrayMembership(column, value, op);
	}

	const compare: ScalarComparison | undefined = SCALAR_COMPARISONS[op];

	if (compare === undefined) {
		throw new Error(
			`@vetojs/drizzle: operator "${op}" on column "${column.name}" has no SQL translation — the engine answers it as unknown, which an allow and a deny read differently, and no single predicate is both.`,
		);
	}

	const scalar = scalarOrThrow(column, value, op);

	if (scalar === null) {
		return compare(column, scalar);
	}

	if (answersUnknown(column, op, scalar)) {
		return unknownWhenPresent(column);
	}

	if (unusable(scalar) || !typeMatches(column, scalar)) {
		return op === ConditionOperator.NotEqual ? TRUE : FALSE;
	}

	const predicate = compare(column, scalar);

	return ORDERING.includes(op) ? unknownOnNaN(column, predicate) : predicate;
};

export type JoinPredicate = (parent: Table, child: Table) => SQL;

export type JoinResolution = { join: JoinPredicate } | { unavailable: string };

export type RelationTarget = {
	table: PgTable;
	resource: string;
	join: JoinPredicate;
	alias: string;
};

export type CompileEnv = (
	from: string | undefined,
	relation: string,
) => RelationTarget;

const noRelations: CompileEnv = (_from, relation) => {
	throw new Error(
		`@vetojs/drizzle: relation "${relation}" requires a table map — use defineTables(...).filter(...) instead of toDrizzle.`,
	);
};

const queryBuilder = new QueryBuilder();

type Frame = {
	table: Table;
	columns: Record<string, Column>;
	resource?: string;
};

const compileRelation = (
	node: Extract<ConditionNode<Record<string, unknown>>, { relation: string }>,
	frame: Frame,
	env: CompileEnv,
): SQL => {
	const relation = node.relation;
	const target = env(frame.resource, relation);
	const child = alias(target.table, target.alias);
	const joinPredicate = target.join(frame.table, child);

	const childFrame: Frame = {
		table: child,
		columns: getTableColumns(child),
		resource: target.resource,
	};

	const inner = compileNode(node.where, childFrame, env);

	const subquery = (predicate: SQL) =>
		queryBuilder
			.select({ present: sql`1` })
			.from(child)
			.where(and(joinPredicate, predicate));

	if (node.type === RelationKind.One) {
		return exists(subquery(inner));
	}

	const quantifier: string = node.match;

	switch (quantifier) {
		case MatchQuantifier.Some:
			return exists(subquery(inner));
		case MatchQuantifier.Every:
			return notExists(subquery(not(inner)));
		case MatchQuantifier.None:
			return notExists(subquery(inner));
		default:
			throw new Error(
				`@vetojs/drizzle: relation "${relation}" uses quantifier "${quantifier}", which the engine answers as unknown — an allow grants nothing while a deny fires, and no single SQL predicate is both.`,
			);
	}
};

const compileNode = (
	node: ConditionNode<Record<string, unknown>>,
	frame: Frame,
	env: CompileEnv,
): SQL => {
	if ("and" in node) {
		const parts = node.and.map((child) => compileNode(child, frame, env));
		return and(...parts) ?? TRUE;
	}

	if ("or" in node) {
		const parts = node.or.map((child) => compileNode(child, frame, env));
		return or(...parts) ?? FALSE;
	}

	if ("not" in node) {
		return not(compileNode(node.not, frame, env));
	}

	if ("relation" in node) {
		return compileRelation(node, frame, env);
	}

	const column = own(frame.columns, node.field);

	if (column === undefined) {
		const where =
			frame.resource === undefined
				? `table "${getTableName(frame.table)}"`
				: `table "${getTableName(frame.table)}" (resource "${frame.resource}")`;

		throw new Error(
			`@vetojs/drizzle: column "${String(node.field)}" does not exist in ${where}.`,
		);
	}

	return compileField(column, node.op, node.value);
};

export const widenCondition = <T extends Record<string, unknown>>(
	condition: ConditionNode<T>,
): ConditionNode<Record<string, unknown>> => {
	return condition as ConditionNode<Record<string, unknown>>;
};

export const compileCondition = (
	condition: ConditionNode<Record<string, unknown>>,
	table: Table,
	env: CompileEnv,
	resource?: string,
): SQL => {
	return compileNode(
		condition,
		{
			table,
			columns: getTableColumns(table),
			...(resource ? { resource } : {}),
		},
		env,
	);
};

/**
 * Compiles one condition against one table — the single-table form of
 * {@link DrizzleSchema.filter}.
 *
 * Reach for {@link defineTables} instead when the policy crosses relations: without a table
 * map there is nothing to join to, and a relation node throws rather than compile to
 * something weaker.
 *
 * @throws when a rule has no honest two-valued SQL form — an unknown column, a relation, an
 * operator the engine answers as unknown.
 *
 * @example
 * db.select().from(posts).where(toDrizzle(ability.where("read", "post"), posts));
 */
export const toDrizzle = <T extends Record<string, unknown>>(
	condition: ConditionNode<T>,
	table: Table,
): SQL => {
	return compileCondition(widenCondition(condition), table, noRelations);
};
