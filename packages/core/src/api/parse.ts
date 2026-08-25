import type { ConditionNode, Rule } from "../model/index.js";
import {
	ConditionOperator,
	isOperator,
	isPlainObject,
	MANAGE_ACTION,
	MATCH_QUANTIFIERS,
	RELATION_KINDS,
	RelationKind,
	type Row,
	RULE_EFFECTS,
	RuleEffect,
} from "../shared/index.js";
import type { CheckedRules } from "./checked-rules.types.js";
import type { RuleParseResult, UnknownRule } from "./parse.types.js";
import type { Vocabulary } from "./vocabulary.types.js";

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
	if (typeof node.field !== "string") {
		errors.push(`${path}.field: expected a string`);
	}

	if (!isOperator(node.op)) {
		errors.push(`${path}.op: unknown operator ${JSON.stringify(node.op)}`);
	}

	if (!("value" in node)) {
		errors.push(`${path}.value: missing`);
		return;
	}

	if (node.value === undefined) {
		errors.push(
			`${path}.value: undefined is not a value a rule may compare to`,
		);
		return;
	}

	const needsArray =
		node.op === ConditionOperator.In ||
		node.op === ConditionOperator.NotIn ||
		node.op === ConditionOperator.HasAny ||
		node.op === ConditionOperator.HasAll;

	if (needsArray && !Array.isArray(node.value)) {
		errors.push(`${path}.value: expected an array for "${node.op}"`);
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
	const hasQuantifier =
		typeof node.match === "string" && MATCH_QUANTIFIERS.includes(node.match);

	if (node.type === RelationKind.Many && !hasQuantifier) {
		errors.push(
			`${path}.match: expected ${quoted(MATCH_QUANTIFIERS)} for a to-many relation`,
		);
		return;
	}

	if (
		node.type === RelationKind.One &&
		"match" in node &&
		node.match !== undefined
	) {
		errors.push(`${path}.match: a to-one relation must not carry a match`);
		return;
	}

	if (node.type !== RelationKind.Many && node.type !== RelationKind.One) {
		errors.push(`${path}.type: expected ${quoted(RELATION_KINDS)}`);
	}
};

const validateRelation = (
	node: Row,
	path: string,
	errors: string[],
	depth: number,
	grammar: ConditionGrammar,
): void => {
	if (typeof node.relation !== "string") {
		errors.push(`${path}.relation: expected a string`);
	}

	validateRelationCardinality(node, path, errors);

	if (!("where" in node)) {
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

	list.forEach((child, index) => {
		walkCondition(child, `${path}[${index}]`, errors, depth + 1, grammar);
	});
};

const shapeOf = (
	node: Row,
	path: string,
	errors: string[],
): ConditionShape | undefined => {
	const named = CONDITION_SHAPES.filter((shape) => shape in node);

	if (named.length > 1) {
		errors.push(
			`${path}: a condition names ${named.map((shape) => `"${shape}"`).join(" and ")} at once — a node carries exactly one shape`,
		);

		return undefined;
	}

	return named[0] ?? "field";
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

const conditionGrammar = (): ConditionGrammar => ({
	nesting: "condition",
	expected: "a condition object",
	expectedList: "expected an array of conditions",
	shapes: {
		and: (node, path, errors, depth, grammar) =>
			walkList(node.and, `${path}.and`, errors, depth, grammar),
		or: (node, path, errors, depth, grammar) =>
			walkList(node.or, `${path}.or`, errors, depth, grammar),
		not: (node, path, errors, depth, grammar) =>
			walkCondition(node.not, `${path}.not`, errors, depth + 1, grammar),
		relation: validateRelation,
		field: validateFieldNode,
	},
});

const outsideConstraints =
	(shape: ConditionShape) =>
	(_node: Row, path: string, errors: string[]): void => {
		errors.push(
			`${path}: "${shape}" is not allowed in payload constraints — they take a field condition or "and"`,
		);
	};

const constraintGrammar = (): ConditionGrammar => ({
	nesting: "constraint",
	expected: "a field condition",
	expectedList: "expected an array",
	shapes: {
		and: (node, path, errors, depth, grammar) =>
			walkList(node.and, `${path}.and`, errors, depth, grammar),
		or: outsideConstraints("or"),
		not: outsideConstraints("not"),
		relation: outsideConstraints("relation"),
		field: validateFieldNode,
	},
});

const validatePayload = (
	payload: unknown,
	path: string,
	errors: string[],
): void => {
	if (!isPlainObject(payload)) {
		errors.push(`${path}: expected a payload object`);
		return;
	}

	if (
		"fields" in payload &&
		payload.fields !== undefined &&
		!isStringArray(payload.fields)
	) {
		errors.push(`${path}.fields: expected an array of strings`);
	}

	if ("constraints" in payload && payload.constraints !== undefined) {
		walkCondition(
			payload.constraints,
			`${path}.constraints`,
			errors,
			0,
			constraintGrammar(),
		);
	}
};

const validateRule = (rule: unknown, path: string, errors: string[]): void => {
	if (!isPlainObject(rule)) {
		errors.push(`${path}: expected a rule object`);
		return;
	}

	if (rule.effect !== RuleEffect.Allow && rule.effect !== RuleEffect.Deny) {
		errors.push(`${path}.effect: expected ${quoted(RULE_EFFECTS)}`);
	}

	if (typeof rule.action !== "string" && !isStringArray(rule.action)) {
		errors.push(`${path}.action: expected a string or an array of strings`);
	}

	if (typeof rule.resource !== "string") {
		errors.push(`${path}.resource: expected a string`);
	}

	if ("where" in rule && rule.where !== undefined) {
		walkCondition(rule.where, `${path}.where`, errors, 0, conditionGrammar());
	}

	if ("payload" in rule && rule.payload !== undefined) {
		validatePayload(rule.payload, `${path}.payload`, errors);
	}
};

const conditionVocabularyReasons = (
	node: ConditionNode<Row>,
	resource: string,
	vocabulary: Vocabulary,
	path: string,
	reasons: string[],
): void => {
	if ("and" in node) {
		for (const [index, child] of node.and.entries()) {
			conditionVocabularyReasons(
				child,
				resource,
				vocabulary,
				`${path}.and[${index}]`,
				reasons,
			);
		}
		return;
	}

	if ("or" in node) {
		for (const [index, child] of node.or.entries()) {
			conditionVocabularyReasons(
				child,
				resource,
				vocabulary,
				`${path}.or[${index}]`,
				reasons,
			);
		}
		return;
	}

	if ("not" in node) {
		conditionVocabularyReasons(
			node.not,
			resource,
			vocabulary,
			`${path}.not`,
			reasons,
		);
		return;
	}

	if ("relation" in node) {
		const relation = vocabulary[resource]?.relations?.[node.relation];

		if (relation === undefined) {
			reasons.push(
				`${path}: unknown relation "${node.relation}" on resource "${resource}"`,
			);
			return;
		}

		if (relation.kind !== node.type) {
			reasons.push(
				`${path}: relation "${node.relation}" is "${relation.kind}", the rule says "${node.type}"`,
			);
			return;
		}

		if (vocabulary[relation.resource] === undefined) {
			reasons.push(
				`${path}: relation "${node.relation}" targets unknown resource "${relation.resource}"`,
			);
			return;
		}

		conditionVocabularyReasons(
			node.where,
			relation.resource,
			vocabulary,
			`${path}.where`,
			reasons,
		);
		return;
	}

	node satisfies { field: unknown };
};

const vocabularyReasons = (
	rule: Rule,
	vocabulary: Vocabulary,
	path: string,
): string[] => {
	const reasons: string[] = [];
	const definition = vocabulary[rule.resource];

	if (definition === undefined) {
		reasons.push(`${path}.resource: unknown resource "${rule.resource}"`);
		return reasons;
	}

	const actions = Array.isArray(rule.action) ? rule.action : [rule.action];

	for (const action of actions) {
		if (action !== MANAGE_ACTION && !definition.actions.includes(action)) {
			reasons.push(
				`${path}.action: unknown action "${action}" for resource "${rule.resource}"`,
			);
		}
	}

	if (rule.where !== undefined) {
		conditionVocabularyReasons(
			rule.where,
			rule.resource,
			vocabulary,
			`${path}.where`,
			reasons,
		);
	}

	return reasons;
};

/**
 * Validates untrusted rule JSON — from a database, an admin UI, or the network.
 *
 * Checks shape recursively and reports every problem with a path, rather than stopping at
 * the first. Returns a result instead of throwing: you decide whether that is a crash, a
 * log line, or a fallback policy.
 *
 * With a vocabulary it also checks the names. A rule mentioning something this deployment
 * doesn't know is handled asymmetrically: an unknown `allow` is quarantined (reported, not
 * applied), an unknown `deny` is kept (a prohibition must keep protecting). The gate can
 * therefore only ever narrow access — which is what makes a rolling deploy safe.
 *
 * Only this overload returns rules {@link buildAbility} accepts.
 *
 * @example
 * const result = parseRules(JSON.parse(raw), ac);
 * if (!result.ok) throw new Error(result.errors.join("\n"));
 * const ability = buildAbility(ac, result.rules);
 */
export function parseRules(
	input: unknown,
	vocabulary: Vocabulary,
): RuleParseResult<CheckedRules>;

/**
 * Shape-only validation. Returns unbranded rules, so it will not satisfy
 * {@link buildAbility} on its own — pass a vocabulary for that.
 */
export function parseRules(input: unknown): RuleParseResult;

export function parseRules(
	input: unknown,
	vocabulary?: Vocabulary,
): RuleParseResult {
	if (!Array.isArray(input)) {
		return { ok: false, errors: ["expected an array of rules"] };
	}

	const errors: string[] = [];

	input.forEach((rule, index) => {
		validateRule(rule, `rules[${index}]`, errors);
	});

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const shaped = input as Rule[];

	if (vocabulary === undefined) {
		return { ok: true, rules: shaped, unknown: [] };
	}

	const rules: Rule[] = [];
	const unknown: UnknownRule[] = [];

	shaped.forEach((rule, index) => {
		const reasons = vocabularyReasons(rule, vocabulary, `rules[${index}]`);

		if (reasons.length === 0) {
			rules.push(rule);
			return;
		}

		const quarantined = rule.effect === RuleEffect.Allow;

		unknown.push({ rule, reasons, quarantined });

		if (!quarantined) {
			rules.push(rule);
		}
	});

	return { ok: true, rules: rules as CheckedRules, unknown };
}
