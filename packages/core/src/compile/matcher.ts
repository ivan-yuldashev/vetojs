import type { ConditionNode, FieldNode, RefNode } from "../model/index.js";
import { MatchQuantifier, RelationKind, type Row } from "../model/index.js";
import { relatedOf } from "../row/index.js";
import { own, owns } from "../shared/index.js";
import type { Matcher, Verdict } from "../verdict/index.js";
import {
	allOf,
	anyOf,
	evaluateOperator,
	kleeneAndOver,
	kleeneNot,
	kleeneOrOver,
} from "../verdict/index.js";

const runOnItem = (item: Row, matcher: Matcher): Verdict => matcher(item);

export type LeafOf = <T extends Row>(node: FieldNode<T>) => Matcher;

const isComparable = (value: unknown): boolean => {
	return value !== undefined && value !== null && !Number.isNaN(value);
};

const compileRef = <T extends Row>(node: RefNode<T>): Matcher => {
	return (row) => {
		const actual = own(row, node.field);
		const other = own(row, node.ref);

		return isComparable(actual) && isComparable(other)
			? evaluateOperator(node.op, actual, other)
			: undefined;
	};
};

const rowLeaf: LeafOf = (node) => (row) => {
	return evaluateOperator(node.op, own(row, node.field), node.value);
};

const compileRelation = <T extends Row>(
	node: Extract<ConditionNode<T>, { relation: string }>,
): Matcher => {
	const inner = compileMatcher(node.where);

	return (row) => {
		const items = relatedOf(row, node.relation, node.type);

		if (items === null) {
			return undefined;
		}

		if (node.type === RelationKind.One) {
			return kleeneOrOver(items, runOnItem, inner);
		}

		switch (node.match) {
			case MatchQuantifier.Some:
				return kleeneOrOver(items, runOnItem, inner);
			case MatchQuantifier.Every:
				return kleeneAndOver(items, runOnItem, inner);
			case MatchQuantifier.None:
				return kleeneNot(kleeneOrOver(items, runOnItem, inner));
			default:
				return undefined;
		}
	};
};

export const compileMatcher = <T extends Row>(
	node: ConditionNode<T>,
	leafOf: LeafOf = rowLeaf,
): Matcher => {
	if (owns(node, "field")) {
		return owns(node, "ref") ? compileRef(node) : leafOf(node);
	}

	if (owns(node, "and")) {
		return allOf(node.and.map((child) => compileMatcher(child, leafOf)));
	}

	if (owns(node, "or")) {
		return anyOf(node.or.map((child) => compileMatcher(child, leafOf)));
	}

	if (owns(node, "not")) {
		const inner = compileMatcher(node.not, leafOf);

		return (row) => kleeneNot(inner(row));
	}

	return compileRelation(node);
};
