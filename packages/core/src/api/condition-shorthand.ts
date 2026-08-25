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

export const refuseUndefined = (scope: string, key: PropertyKey): never => {
	throw new TypeError(
		`veto: ${scope}.${String(key)} is undefined — dropping it would widen the rule to every row. Pass a value, or build the shorthand without the key.`,
	);
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

	if (!isOperator(operator)) {
		return null;
	}

	if (value === undefined) {
		refuseUndefined("where", operator);
	}

	return { op: operator, value: normalizeConditionValue(value) };
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
		if (["and", "or", "not"].includes(field)) {
			continue;
		}

		if (raw === undefined) {
			refuseUndefined("payload constraints", field);
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
