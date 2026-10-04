import type { CheckedRules } from "../model/index.js";
import {
	ConditionOperator,
	isOperator,
	isQuantifier,
	MATCH_QUANTIFIERS,
	RELATION_KINDS,
	RelationKind,
	type Row,
	RULE_EFFECTS,
	RuleEffect,
} from "../model/index.js";
import { isPlainObject, own, owns } from "../shared/index.js";
import type { RuleParseResult } from "./parse.types.js";

const MAX_CONDITION_DEPTH = 64;

export const CONDITION_SHAPES = [
	"and",
	"or",
	"not",
	"relation",
	"field",
] as const;

type ConditionShape = (typeof CONDITION_SHAPES)[number];

type ShapeValidator = (
	node: Row,
	path: string,
	errors: string[],
	depth: number,
	grammar: ConditionGrammar,
) => void;

type ConditionGrammar = {
	nesting: string;
	expected: string;
	expectedList: string;
	shapes: Record<ConditionShape, ShapeValidator>;
};

const isStringArray = (value: unknown): value is string[] => {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
};

const validateFieldNode = (node: Row, path: string, errors: string[]): void => {
	const field = own(node, "field");
	const op = own(node, "op");

	if (typeof field !== "string") {
		errors.push(`${path}.field: expected a string`);
	}

	if (!isOperator(op)) {
		errors.push(`${path}.op: unknown operator ${JSON.stringify(op)}`);
	}

	if (!owns(node, "value")) {
		errors.push(`${path}.value: missing`);
		return;
	}

	const { value } = node;

	if (value === undefined) {
		errors.push(
			`${path}.value: undefined is not a value a rule may compare to`,
		);
		return;
	}

	if (op === ConditionOperator.Exists && typeof value !== "boolean") {
		errors.push(`${path}.value: expected a boolean for "exists"`);
		return;
	}

	if (op === ConditionOperator.Contains && typeof value !== "string") {
		errors.push(`${path}.value: expected a string for "contains"`);
		return;
	}

	const isOrdered =
		op === ConditionOperator.GreaterThan ||
		op === ConditionOperator.GreaterThanOrEqual ||
		op === ConditionOperator.LessThan ||
		op === ConditionOperator.LessThanOrEqual;

	if (isOrdered && typeof value !== "number" && typeof value !== "string") {
		errors.push(`${path}.value: expected a number or a string for "${op}"`);
		return;
	}

	const needsArray =
		op === ConditionOperator.In ||
		op === ConditionOperator.NotIn ||
		op === ConditionOperator.HasAny ||
		op === ConditionOperator.HasAll;

	if (needsArray && !Array.isArray(value)) {
		errors.push(`${path}.value: expected an array for "${op}"`);
	}
};

const quoted = (values: readonly string[]): string => {
	return values.map((value) => `"${value}"`).join(" | ");
};

const validateRelationCardinality = (
	node: Row,
	path: string,
	errors: string[],
): void => {
	const type = own(node, "type");
	const match = own(node, "match");

	if (type === RelationKind.Many) {
		if (!isQuantifier(match)) {
			errors.push(
				`${path}.match: expected ${quoted(MATCH_QUANTIFIERS)} for a to-many relation`,
			);
		}

		return;
	}

	if (type === RelationKind.One) {
		if (match !== undefined) {
			errors.push(`${path}.match: a to-one relation must not carry a match`);
		}

		return;
	}

	errors.push(`${path}.type: expected ${quoted(RELATION_KINDS)}`);
};

const validateRelation = (
	node: Row,
	path: string,
	errors: string[],
	depth: number,
	grammar: ConditionGrammar,
): void => {
	if (typeof own(node, "relation") !== "string") {
		errors.push(`${path}.relation: expected a string`);
	}

	validateRelationCardinality(node, path, errors);

	if (!owns(node, "where")) {
		errors.push(`${path}.where: missing`);
		return;
	}

	walkCondition(node.where, `${path}.where`, errors, depth + 1, grammar);
};

const walkList = (
	list: unknown,
	path: string,
	errors: string[],
	depth: number,
	grammar: ConditionGrammar,
): void => {
	if (!Array.isArray(list)) {
		errors.push(`${path}: ${grammar.expectedList}`);
		return;
	}

	if (list.length === 0) {
		errors.push(
			`${path}: expected at least one condition — an empty group says nothing about a row`,
		);
		return;
	}

	for (const [index, child] of list.entries()) {
		walkCondition(child, `${path}[${index}]`, errors, depth + 1, grammar);
	}
};

const shapeOf = (
	node: Row,
	path: string,
	errors: string[],
): ConditionShape | undefined => {
	const named = CONDITION_SHAPES.filter((shape) => owns(node, shape));

	if (named.length > 1) {
		errors.push(
			`${path}: a condition names ${named.map((shape) => `"${shape}"`).join(" and ")} at once — a node carries exactly one shape`,
		);

		return undefined;
	}

	const shape = named[0];

	if (shape === undefined) {
		errors.push(
			`${path}: a condition names none of ${quoted(CONDITION_SHAPES)} — a node carries exactly one shape`,
		);

		return undefined;
	}

	return shape;
};

const walkCondition = (
	node: unknown,
	path: string,
	errors: string[],
	depth: number,
	grammar: ConditionGrammar,
): void => {
	if (depth > MAX_CONDITION_DEPTH) {
		errors.push(
			`${path}: ${grammar.nesting} nesting too deep (max ${MAX_CONDITION_DEPTH})`,
		);
		return;
	}

	if (!isPlainObject(node)) {
		errors.push(`${path}: expected ${grammar.expected}`);
		return;
	}

	const shape = shapeOf(node, path, errors);

	if (shape === undefined) {
		return;
	}

	grammar.shapes[shape](node, path, errors, depth, grammar);
};

const walkAnd: ShapeValidator = (node, path, errors, depth, grammar) =>
	walkList(node.and, `${path}.and`, errors, depth, grammar);

const walkOr: ShapeValidator = (node, path, errors, depth, grammar) =>
	walkList(node.or, `${path}.or`, errors, depth, grammar);

const walkNot: ShapeValidator = (node, path, errors, depth, grammar) =>
	walkCondition(node.not, `${path}.not`, errors, depth + 1, grammar);

const CONDITION_GRAMMAR: ConditionGrammar = {
	nesting: "condition",
	expected: "a condition object",
	expectedList: "expected an array of conditions",
	shapes: {
		and: walkAnd,
		or: walkOr,
		not: walkNot,
		relation: validateRelation,
		field: validateFieldNode,
	},
};

const outsideValues = (
	shape: ConditionShape,
	path: string,
	errors: string[],
): void => {
	errors.push(
		`${path}: "${shape}" is not allowed in values — they take a field condition or "and"`,
	);
};

const VALUES_GRAMMAR: ConditionGrammar = {
	nesting: "values",
	expected: "a field condition",
	expectedList: "expected an array",
	shapes: {
		and: walkAnd,
		or: (_node, path, errors) => outsideValues("or", path, errors),
		not: (_node, path, errors) => outsideValues("not", path, errors),
		relation: (_node, path, errors) => outsideValues("relation", path, errors),
		field: validateFieldNode,
	},
};

const validateFields = (
	fields: unknown,
	path: string,
	errors: string[],
): void => {
	if (!isStringArray(fields)) {
		errors.push(`${path}: expected an array of strings`);
		return;
	}

	if (fields.length === 0) {
		errors.push(
			`${path}: expected at least one field name — naming none says nothing about a write`,
		);
	} else if (fields.includes("")) {
		errors.push(
			`${path}: expected a field name — an empty key is not a field a rule can name`,
		);
	}
};

const validateRule = (rule: unknown, path: string, errors: string[]): void => {
	if (!isPlainObject(rule)) {
		errors.push(`${path}: expected a rule object`);
		return;
	}

	const effect = own(rule, "effect");
	const action = own(rule, "action");
	const resource = own(rule, "resource");

	if (effect !== RuleEffect.Allow && effect !== RuleEffect.Deny) {
		errors.push(`${path}.effect: expected ${quoted(RULE_EFFECTS)}`);
	}

	if (typeof action !== "string" && !isStringArray(action)) {
		errors.push(`${path}.action: expected a string or an array of strings`);
	} else if (Array.isArray(action) && action.length === 0) {
		errors.push(
			`${path}.action: expected at least one action — naming none says nothing about a request`,
		);
	} else if ((Array.isArray(action) ? action : [action]).includes("")) {
		errors.push(
			`${path}.action: expected an action name — an empty one matches nothing`,
		);
	}

	if (typeof resource !== "string") {
		errors.push(`${path}.resource: expected a string`);
	} else if (resource === "") {
		errors.push(
			`${path}.resource: expected a resource name — an empty one matches nothing`,
		);
	}

	const where = own(rule, "where");

	if (where !== undefined) {
		walkCondition(where, `${path}.where`, errors, 0, CONDITION_GRAMMAR);
	}

	if (owns(rule, "payload")) {
		errors.push(
			`${path}.payload: rules carry fields and values themselves — this rule was written for an older build, and reading it would drop what its payload said`,
		);
	}

	const fields = own(rule, "fields");

	if (fields !== undefined) {
		validateFields(fields, `${path}.fields`, errors);
	}

	const values = own(rule, "values");

	if (values !== undefined) {
		walkCondition(values, `${path}.values`, errors, 0, VALUES_GRAMMAR);
	}
};

/**
 * Validates untrusted rule JSON — from a database, an admin UI, or the network.
 *
 * Checks the shape recursively and reports every problem with a path, rather than stopping
 * at the first. Returns a result instead of throwing: you decide whether that is a crash, a
 * log line, or a fallback policy.
 *
 * Names are not checked against anything. Whether a resource, an action or a field exists is
 * a question for the compiler where rules are written, and for code generation where they
 * arrive from outside — so rules and the deployment reading them have to come from the same
 * generation.
 *
 * @example
 * const result = parseRules(JSON.parse(raw));
 * if (!result.ok) throw new Error(result.errors.join("\n"));
 * const ability = buildAbility(ac, result.rules);
 */
export const parseRules = (rules: unknown): RuleParseResult<CheckedRules> => {
	if (!Array.isArray(rules)) {
		return { ok: false, errors: ["expected an array of rules"] };
	}

	const errors: string[] = [];

	for (const [index, rule] of rules.entries()) {
		validateRule(rule, `rules[${index}]`, errors);
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	return { ok: true, rules: rules as CheckedRules };
};
