import {
	type ConditionNode,
	MATCH_QUANTIFIERS,
	type MatchQuantifier,
	RelationKind,
	type Row,
} from "../model/index.js";
import { isPlainObject, own, owns } from "../shared/index.js";
import {
	combineNodes,
	definedValueOf,
	fieldNode,
	keyNameOf,
	refuseUndefined,
} from "./condition-shorthand.js";
import type { Relation, ResourceMap } from "./define-abilities.types.js";

export type Shorthand = {
	and?: Shorthand[];
	or?: Shorthand[];
	not?: Shorthand;
	[key: string]: unknown;
};

type Quantified = Partial<Record<MatchQuantifier, Shorthand>>;

const relationsOf = (
	ac: ResourceMap,
	resource: string,
): Record<string, Relation> | undefined => {
	const definition = own(ac, resource);

	return definition === undefined ? undefined : own(definition, "relations");
};

const refuseNotACondition = (key: string): never => {
	throw new TypeError(
		`veto: where.${key} names a relation, which takes a condition — anything else leaves the relation unconstrained.`,
	);
};

const relationNodes = (
	key: string,
	relation: Relation,
	value: unknown,
	ac: ResourceMap,
): ConditionNode<Row>[] => {
	if (!isPlainObject<Shorthand & Quantified>(value)) {
		return refuseNotACondition(key);
	}

	if (relation.kind === RelationKind.One) {
		return [
			{
				relation: key,
				type: RelationKind.One,
				where: compileWhereInput(value, ac, relation.resource),
			},
		];
	}

	return MATCH_QUANTIFIERS.flatMap((match) => {
		if (!owns(value, match)) {
			return [];
		}

		const nested = value[match];

		if (nested === undefined) {
			return refuseUndefined(`where.${key}`, match);
		}

		return [
			{
				relation: key,
				type: RelationKind.Many,
				match,
				where: compileWhereInput(nested, ac, relation.resource),
			},
		];
	});
};

export const compileWhereInput = (
	shorthand: Shorthand,
	ac: ResourceMap,
	resource: string,
): ConditionNode<Row> => {
	const relations = relationsOf(ac, resource);
	const groups: ConditionNode<Row>[] = [];
	const keyed: ConditionNode<Row>[] = [];

	const branch = (child: Shorthand): ConditionNode<Row> => {
		return compileWhereInput(child, ac, resource);
	};

	for (const ownKey of Reflect.ownKeys(shorthand)) {
		const key = keyNameOf(ownKey, "where");

		if (key === "and") {
			const nested = shorthand.and;

			if (nested !== undefined) {
				groups.push({ and: nested.map(branch) });
			}

			continue;
		}

		if (key === "or") {
			const nested = shorthand.or;

			if (nested !== undefined) {
				groups.push({ or: nested.map(branch) });
			}

			continue;
		}

		if (key === "not") {
			const nested = shorthand.not;

			if (nested !== undefined) {
				groups.push({ not: branch(nested) });
			}

			continue;
		}

		const value = definedValueOf(shorthand, key, "where");
		const relation = relations === undefined ? undefined : own(relations, key);

		if (relation !== undefined) {
			keyed.push(...relationNodes(key, relation, value, ac));
			continue;
		}

		keyed.push(fieldNode(key, value, "where"));
	}

	return combineNodes(groups.length === 0 ? keyed : [...groups, ...keyed]);
};
