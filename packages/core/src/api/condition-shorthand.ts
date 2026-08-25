import type { FieldConditionNode } from "../model/index.js";
import {
	ConditionOperator,
	isOperator,
	isPlainObject,
	type Row,
} from "../shared/index.js";
import { everything } from "./vacuous.js";

export const normalizeConditionValue = (value: unknown): unknown => {
	if (value instanceof Date) {
		return value.getTime();
	}

	if (Array.isArray(value)) {
		return value.map((item) => (item instanceof Date ? item.getTime() : item));
	}

	return value;
};

export const asOperator = (
	raw: unknown,
): { op: ConditionOperator; value: unknown } | null => {
	if (!isPlainObject(raw)) {
		return null;
	}

	const entries = Object.entries(raw);
	const first = entries[0];

	if (entries.length !== 1 || first === undefined) {
		return null;
	}

	const [operator, value] = first;

	return isOperator(operator)
		? { op: operator, value: normalizeConditionValue(value) }
		: null;
};

export const combineNodes = <N>(nodes: N[]): N | { and: N[] } => {
	if (nodes.length === 0) {
		return everything<N>();
	}

	if (nodes.length === 1 && nodes[0] !== undefined) {
		return nodes[0];
	}

	return { and: nodes };
};

const extractFieldNodes = (condition: Row): FieldConditionNode<Row>[] => {
	const nodes: FieldConditionNode<Row>[] = [];

	for (const [field, raw] of Object.entries(condition)) {
		if (["and", "or", "not"].includes(field) || raw === undefined) {
			continue;
		}

		const operator = asOperator(raw);

		if (operator) {
			nodes.push({ field, op: operator.op, value: operator.value });
			continue;
		}

		nodes.push({
			field,
			op: ConditionOperator.Equal,
			value: normalizeConditionValue(raw),
		});
	}

	return nodes;
};

export const compilePayloadConstraints = (
	condition: unknown,
): FieldConditionNode<Row> => {
	if (!isPlainObject(condition)) {
		return everything<FieldConditionNode<Row>>();
	}

	const nodes: FieldConditionNode<Row>[] = [];

	if ("and" in condition && Array.isArray(condition.and)) {
		nodes.push({ and: condition.and.map(compilePayloadConstraints) });
	}

	nodes.push(...extractFieldNodes(condition));

	return combineNodes(nodes);
};
