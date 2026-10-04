import {
	type ConditionNode,
	type FieldNode,
	MATCH_QUANTIFIERS,
	type MatchQuantifier,
	RelationKind,
	type Row,
	type WhenNode,
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

type Tree<Leaf> =
	| Leaf
	| { and: Tree<Leaf>[] }
	| { or: Tree<Leaf>[] }
	| { not: Tree<Leaf> };

type LeavesOf<Leaf> = (key: string, value: unknown) => Leaf[];

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

const compileTree = <Leaf>(
	shorthand: Shorthand,
	scope: string,
	leavesOf: LeavesOf<Leaf>,
): Tree<Leaf> => {
	const groups: Tree<Leaf>[] = [];
	const keyed: Tree<Leaf>[] = [];

	const branch = (child: Shorthand): Tree<Leaf> => {
		return compileTree(child, scope, leavesOf);
	};

	for (const ownKey of Reflect.ownKeys(shorthand)) {
		const key = keyNameOf(ownKey, scope);

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

		keyed.push(...leavesOf(key, definedValueOf(shorthand, key, scope)));
	}

	return combineNodes(groups.length === 0 ? keyed : [...groups, ...keyed]);
};

export const compileWhereInput = (
	shorthand: Shorthand,
	ac: ResourceMap,
	resource: string,
): ConditionNode<Row> => {
	const relations = relationsOf(ac, resource);

	return compileTree<ConditionNode<Row>>(shorthand, "where", (key, value) => {
		const relation = relations === undefined ? undefined : own(relations, key);

		return relation === undefined
			? [fieldNode(key, value, "where")]
			: relationNodes(key, relation, value, ac);
	});
};

export const compileWhenInput = (shorthand: Shorthand): WhenNode => {
	return compileTree<FieldNode<Row>>(shorthand, "when", (key, value) => [
		fieldNode(key, value, "when"),
	]);
};
