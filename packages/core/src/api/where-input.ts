import type { ConditionNode } from "../model/index.js";
import {
	ConditionOperator,
	isOperator,
	isPlainObject,
	MATCH_QUANTIFIERS,
	type MatchQuantifier,
	RelationKind,
} from "../shared/index.js";
import {
	asOperator,
	combineNodes,
	normalizeConditionValue,
	refuseUndefined,
} from "./condition-shorthand.js";
import type { Relation, ResourceMap } from "./define-abilities.js";
import { nothing } from "./vacuous.js";

type Node = ConditionNode<Record<string, unknown>>;

const relationsOf = (
	ac: ResourceMap,
	resource: string,
): Record<string, Relation> => ac[resource]?.relations ?? {};

const isMatchQuantifier = (match: string): match is MatchQuantifier => {
	return MATCH_QUANTIFIERS.includes(match);
};

const quantifierNode = (
	relation: string,
	match: string,
	nested: unknown,
	ac: ResourceMap,
	resource: string,
): Node => {
	if (!isMatchQuantifier(match) || !isPlainObject(nested)) {
		return nothing<Node>();
	}

	return {
		relation,
		type: "many",
		match,
		where: compileWhereInput(nested, ac, resource),
	};
};

const relationNodes = (
	key: string,
	relation: Relation,
	value: unknown,
	ac: ResourceMap,
): Node[] => {
	if (relation.kind === RelationKind.One) {
		return [
			{
				relation: key,
				type: "one",
				where: compileWhereInput(value, ac, relation.resource),
			},
		];
	}

	if (!isPlainObject(value)) {
		return [nothing<Node>()];
	}

	return Object.entries(value).map(([match, nested]) => {
		if (nested === undefined) {
			refuseUndefined(`where.${key}`, match);
		}

		return quantifierNode(key, match, nested, ac, relation.resource);
	});
};

const isCompiledNode = (value: Record<string, unknown>): boolean => {
	const keys = Object.keys(value);

	if (keys.length === 3 && typeof value.op === "string") {
		return isOperator(value.op) && "field" in value && "value" in value;
	}

	return (
		typeof value.relation === "string" &&
		(value.type === RelationKind.One || value.type === RelationKind.Many) &&
		isPlainObject(value.where)
	);
};

export const compileWhereInput = (
	shorthand: unknown,
	ac: ResourceMap,
	resource: string,
): Node => {
	if (!isPlainObject(shorthand)) {
		return nothing<Node>();
	}

	if (isCompiledNode(shorthand)) {
		throw new TypeError(
			"veto: where received an already-compiled condition, which reads as fields named after its own keys. Pass the shorthand you wrote it from, or the whole rule through parseRules.",
		);
	}

	const relations = relationsOf(ac, resource);
	const nodes: Node[] = [];

	for (const [key, value] of Object.entries(shorthand)) {
		if (value === undefined) {
			refuseUndefined("where", key);
		}

		if (key === "and" || key === "or") {
			if (!Array.isArray(value)) {
				nodes.push(nothing<Node>());
				continue;
			}

			const children = value.map((child) =>
				compileWhereInput(child, ac, resource),
			);

			nodes.push(key === "and" ? { and: children } : { or: children });

			continue;
		}

		if (key === "not") {
			nodes.push(
				isPlainObject(value)
					? { not: compileWhereInput(value, ac, resource) }
					: nothing<Node>(),
			);

			continue;
		}

		const relation = relations[key];

		if (relation !== undefined) {
			nodes.push(...relationNodes(key, relation, value, ac));

			continue;
		}

		const operator = asOperator(value);

		nodes.push(
			operator
				? { field: key, op: operator.op, value: operator.value }
				: {
						field: key,
						op: ConditionOperator.Equal,
						value: normalizeConditionValue(value),
					},
		);
	}

	if (nodes.length === 0 && Object.keys(shorthand).length > 0) {
		throw new TypeError(
			`veto: where describes no condition — ${JSON.stringify(shorthand)} compiles to nothing, which would widen the rule to every row.`,
		);
	}

	return combineNodes(nodes);
};
