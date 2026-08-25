import type { ConditionNode } from "../model/index.js";
import { MatchQuantifier, RelationKind, type Row } from "../shared/index.js";
import { evaluateOperator } from "./operator.js";
import { ownField, relatedOf } from "./read.js";
import {
	kleeneAndOver,
	kleeneNot,
	kleeneOrOver,
	type Verdict,
} from "./verdict.js";

export type Matcher = (instance: Row) => Verdict;

const walkForRelation = <T extends Row>(node: ConditionNode<T>): boolean => {
	if ("relation" in node) {
		return true;
	}

	if ("and" in node) {
		return node.and.some(walkForRelation);
	}

	if ("or" in node) {
		return node.or.some(walkForRelation);
	}

	if ("not" in node) {
		return walkForRelation(node.not);
	}

	return false;
};

const reaching = new WeakMap<object, boolean>();

const touchesRelation = <T extends Row>(node: ConditionNode<T>): boolean => {
	const known = reaching.get(node);

	if (known !== undefined) {
		return known;
	}

	const found = walkForRelation(node);

	reaching.set(node, found);

	return found;
};

const runOnItem = (item: Row, matcher: Matcher): Verdict => matcher(item);

const compileRelation = <T extends Row>(
	node: Extract<ConditionNode<T>, { relation: string }>,
	visitAll: boolean,
): Matcher => {
	const relation = node.relation;
	const inner = compile(node.where, visitAll);
	const one = node.type === RelationKind.One;
	const quantifier = "match" in node ? node.match : undefined;
	const everyItem = touchesRelation(node.where);

	return (instance) => {
		const related = relatedOf(instance, relation);

		if (related === null) {
			return undefined;
		}

		const items = related.items;

		if (one) {
			const verdict = kleeneOrOver(items, runOnItem, inner, everyItem);

			return related.asList ? undefined : verdict;
		}

		switch (quantifier) {
			case MatchQuantifier.Some:
				return kleeneOrOver(items, runOnItem, inner, everyItem);
			case MatchQuantifier.Every:
				return kleeneAndOver(items, runOnItem, inner, everyItem);
			case MatchQuantifier.None:
				return kleeneNot(kleeneOrOver(items, runOnItem, inner, everyItem));
			default:
				return undefined;
		}
	};
};

const compile = <T extends Row>(
	node: ConditionNode<T>,
	visitAll: boolean,
): Matcher => {
	if ("and" in node) {
		const children = node.and.map((child) => compile(child, visitAll));

		return (instance) => {
			let result: Verdict = true;

			for (const child of children) {
				const verdict = child(instance);

				if (verdict === false) {
					if (!visitAll) {
						return false;
					}

					result = false;
					continue;
				}

				if (verdict === undefined && result === true) {
					result = undefined;
				}
			}

			return result;
		};
	}

	if ("or" in node) {
		const children = node.or.map((child) => compile(child, visitAll));

		return (instance) => {
			let result: Verdict = false;

			for (const child of children) {
				const verdict = child(instance);

				if (verdict === true) {
					if (!visitAll) {
						return true;
					}

					result = true;
					continue;
				}

				if (verdict === undefined && result === false) {
					result = undefined;
				}
			}

			return result;
		};
	}

	if ("not" in node) {
		const inner = compile(node.not, visitAll);

		return (instance) => kleeneNot(inner(instance));
	}

	if ("relation" in node) {
		return compileRelation(node, visitAll);
	}

	const { op, value } = node;
	const field: PropertyKey = node.field;

	if (typeof field === "symbol") {
		return () => evaluateOperator(op, undefined, value);
	}

	const name = typeof field === "number" ? String(field) : field;

	return (instance) => evaluateOperator(op, ownField(instance, name), value);
};

const matchers = new WeakMap<object, Matcher>();

export const matcherFor = <T extends Row>(node: ConditionNode<T>): Matcher => {
	const known = matchers.get(node);

	if (known !== undefined) {
		return known;
	}

	const made = compile(node, touchesRelation(node));

	matchers.set(node, made);

	return made;
};
