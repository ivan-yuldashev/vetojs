import type { ConditionNode, FieldNode } from "../model/index.js";
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

const rowLeaf =
	<T extends Row>(node: FieldNode<T>): Matcher =>
	(row) => {
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
): Matcher => {
	if (owns(node, "field")) {
		return rowLeaf(node);
	}

	if (owns(node, "and")) {
		return allOf(node.and.map((child) => compileMatcher(child)));
	}

	if (owns(node, "or")) {
		return anyOf(node.or.map((child) => compileMatcher(child)));
	}

	if (owns(node, "not")) {
		const inner = compileMatcher(node.not);

		return (row) => kleeneNot(inner(row));
	}

	return compileRelation(node);
};
