import type { FieldConditionNode } from "../model/index.js";
import { ConditionOperator, isOperator, type Row } from "../model/index.js";
import { isPlainObject, only } from "../shared/index.js";

const normalizeConditionValue = (value: unknown): unknown => {
	if (value instanceof Date) {
		return value.getTime();
	}

	if (Array.isArray(value)) {
		return value.map((item) => (item instanceof Date ? item.getTime() : item));
	}

	return value;
};

const asOperator = (
	raw: unknown,
	scope: string,
	field: string,
): { op: ConditionOperator; value: unknown } | null => {
	if (!isPlainObject(raw)) {
		return null;
	}

	const operator = only(Object.keys(raw));

	if (operator === undefined || !isOperator(operator)) {
		return null;
	}

	const value = raw[operator];

	if (value === undefined) {
		refuseUndefined(`${scope}.${field}`, operator);
	}

	return { op: operator, value: normalizeConditionValue(value) };
};

type ValueNode = { field: string; op: ConditionOperator; value: unknown };

export const fieldNode = (
	field: string,
	raw: unknown,
	scope: string,
): ValueNode => {
	const operator = asOperator(raw, scope, field);

	return operator === null
		? {
				field,
				op: ConditionOperator.Equal,
				value: normalizeConditionValue(raw),
			}
		: { field, ...operator };
};

const symbolRefusal = (scope: string, key: symbol): TypeError => {
	return new TypeError(
		`veto: ${scope} names ${String(key)} — a rule outlives JSON and a symbol does not, so the key would be dropped and the rule would widen. Name the field with a string.`,
	);
};

export const refuseUndefined = (scope: string, key: string): never => {
	throw new TypeError(
		`veto: ${scope}.${String(key)} is undefined — dropping it would widen the rule. Pass a value, or build the shorthand without the key.`,
	);
};

export const keyNameOf = (key: string | symbol, scope: string): string => {
	if (typeof key === "symbol") {
		throw symbolRefusal(scope, key);
	}

	return key;
};

export const definedValueOf = (
	shorthand: Row,
	key: string,
	scope: string,
): unknown => {
	const value = shorthand[key];

	if (value === undefined) {
		refuseUndefined(scope, key);
	}

	return value;
};

export const combineNodes = <N>(nodes: N[]): N | { and: N[] } => {
	return only(nodes) ?? { and: nodes };
};

export type ValuesShorthand = {
	and?: ValuesShorthand[];
	[key: string]: unknown;
};

export const compileValues = (
	condition: ValuesShorthand,
): FieldConditionNode<Row> => {
	const fields: FieldConditionNode<Row>[] = [];
	let fieldGroup: FieldConditionNode<Row> | undefined;

	for (const ownKey of Reflect.ownKeys(condition)) {
		const key = keyNameOf(ownKey, "values");

		if (key === "and") {
			const nested = condition.and;

			if (nested !== undefined) {
				fieldGroup = { and: nested.map(compileValues) };
			}

			continue;
		}

		fields.push(
			fieldNode(key, definedValueOf(condition, key, "values"), "values"),
		);
	}

	return combineNodes(
		fieldGroup === undefined ? fields : [fieldGroup, ...fields],
	);
};
