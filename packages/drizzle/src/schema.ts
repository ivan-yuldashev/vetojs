import type {
	AbilitySet,
	ConditionNode,
	RelationKind,
	ResourceMap,
} from "@vetojs/core";
import { and, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
	type CompileEnv,
	compileCondition,
	type JoinPredicate,
	type JoinResolution,
	type RelationTarget,
	widenCondition,
} from "./compile.js";
import { deriveJoinFromForeignKeys } from "./foreign-key-join.js";
import { own } from "./own.js";
import type { DrizzleSchema, JoinsFor, TableMap } from "./schema.types.js";

type WideJoins = Partial<
	Record<string, Partial<Record<string, JoinPredicate>>>
>;

type ResolvedJoins = Record<string, Record<string, JoinResolution>>;

type FilterArgs<AC extends ResourceMap> =
	| [
			resource: string,
			condition: ConditionNode<Record<string, unknown>>,
			...narrow: SQLWrapper[],
	  ]
	| [
			ability: AbilitySet<AC>,
			action: string,
			resource: string,
			...narrow: SQLWrapper[],
	  ];

const namesResourceFirst = <AC extends ResourceMap>(
	args: FilterArgs<AC>,
): args is [
	resource: string,
	condition: ConditionNode<Record<string, unknown>>,
	...narrow: SQLWrapper[],
] => typeof args[0] === "string";

const resolveJoin = (
	explicit: JoinPredicate | undefined,
	parent: PgTable | null | undefined,
	target: PgTable | null | undefined,
	kind: RelationKind,
): JoinResolution | undefined => {
	if (explicit !== undefined) {
		return { join: explicit };
	}

	if (parent === null || parent === undefined) {
		return undefined;
	}

	if (target === null || target === undefined) {
		return undefined;
	}

	return deriveJoinFromForeignKeys(parent, target, kind);
};

const resolveJoins = (
	ac: ResourceMap,
	tables: Record<string, PgTable | null | undefined>,
	joins: WideJoins,
): ResolvedJoins => {
	const resolved: ResolvedJoins = {};

	for (const [resource, definition] of Object.entries(ac)) {
		for (const [relationName, relation] of Object.entries(
			definition.relations ?? {},
		)) {
			const resolution = resolveJoin(
				joins[resource]?.[relationName],
				tables[resource],
				tables[relation.resource],
				relation.kind,
			);

			if (resolution === undefined) {
				continue;
			}

			const forResource = resolved[resource] ?? {};

			forResource[relationName] = resolution;
			resolved[resource] = forResource;
		}
	}

	return resolved;
};

/**
 * Wires resources to Drizzle tables, once, so a policy can become SQL.
 *
 * Joins for relations are derived from the foreign keys your schema already declares; pass
 * `joins` only for the predicates a key cannot express. Nothing runs here — the returned
 * {@link DrizzleSchema.filter} compiles a condition when you call it.
 *
 * @param ac - your {@link defineAbilities} declarations
 * @param tables - one table per resource, or `null` for a resource with no rows
 * @param joins - join predicates a foreign key cannot express
 *
 * @example
 * const schema = defineTables(ac, { post: posts, user: users, comment: comments });
 * db.select().from(posts).where(schema.filter(ability, "read", "post"));
 */
export const defineTables = <AC extends ResourceMap, M extends TableMap<AC>>(
	ac: AC,
	tables: M,
	joins: JoinsFor<AC, M> = {},
): DrizzleSchema<AC> => {
	const byResource: Record<string, PgTable | null | undefined> = tables;

	const resolvedJoins = resolveJoins(ac, byResource, joins as WideJoins);

	const tableOrThrow = (resource: string, subject: string): PgTable => {
		const table = own(byResource, resource);

		if (table === null) {
			throw new Error(
				`@vetojs/drizzle: ${subject} is the phantom resource "${resource}" (declared without a table) — it has no SQL form.`,
			);
		}

		if (table === undefined) {
			throw new Error(
				`@vetojs/drizzle: ${subject} is "${resource}", which is not present in the defineTables table map.`,
			);
		}

		return table;
	};

	const resolveRelation = (
		from: string | undefined,
		relation: string,
	): Omit<RelationTarget, "alias"> => {
		const declared = from === undefined ? undefined : own(ac, from);
		const meta = own(declared?.relations, relation);

		if (meta === undefined) {
			throw new Error(
				`@vetojs/drizzle: relation "${relation}" of resource "${from}" is not declared in the ability registry (ac.relations).`,
			);
		}

		const target = tableOrThrow(
			meta.resource,
			`the target of relation "${relation}"`,
		);

		const resolution =
			from === undefined ? undefined : resolvedJoins[from]?.[relation];

		if (resolution === undefined || "unavailable" in resolution) {
			const cause =
				resolution === undefined ? "" : ` (${resolution.unavailable})`;

			throw new Error(
				`@vetojs/drizzle: no join predicate for relation "${relation}" of resource "${from}"${cause} — pass it in defineTables(ac, tables, joins) or declare .references() on the foreign-key column so the join can be derived.`,
			);
		}

		return { table: target, resource: meta.resource, join: resolution.join };
	};

	const buildEnv = (): CompileEnv => {
		let seen = 0;

		return (from, relation) => {
			const resolved = resolveRelation(from, relation);

			seen += 1;

			return { ...resolved, alias: `${relation}_${seen}` };
		};
	};

	const compileFor = (
		resource: string,
		condition: ConditionNode<Record<string, unknown>>,
		narrow: SQLWrapper[],
	): SQL => {
		const table = tableOrThrow(resource, "the filtered resource");
		const policy = compileCondition(condition, table, buildEnv(), resource);

		return and(...narrow, policy) ?? policy;
	};

	const filter = (...args: FilterArgs<AC>): SQL => {
		if (namesResourceFirst(args)) {
			const [resource, condition, ...narrow] = args;

			return compileFor(resource, condition, narrow);
		}

		const [ability, action, resource, ...narrow] = args;

		return compileFor(
			resource,
			widenCondition(ability.where(action, resource)),
			narrow,
		);
	};

	return { filter: filter as DrizzleSchema<AC>["filter"] };
};
