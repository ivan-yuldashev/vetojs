import type { FieldConditionNode, RefNode } from "../model/index.js";
import {
	ConditionOperator,
	isOperator,
	isRefOperator,
	type Row,
} from "../model/index.js";
import { isPlainObject, only, own } from "../shared/index.js";

const finiteValueOf = (
	value: unknown,
	scope: string,
	field: string,
): unknown => {
	const plain = value instanceof Date ? value.getTime() : value;

	if (typeof plain === "number" && !Number.isFinite(plain)) {
		throw new TypeError(
			`veto: ${scope}.${field} is ${plain} — JSON would carry it as null and the rule would change once stored. Pass a finite number or a valid Date.`,
		);
	}

	return plain;
};

const normalizeConditionValue = (
	value: unknown,
	scope: string,
	field: string,
): unknown => {
	return Array.isArray(value)
		? value.map((item) => finiteValueOf(item, scope, field))
		: finiteValueOf(value, scope, field);
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

	return {
		op: operator,
		value: normalizeConditionValue(value, scope, field),
	};
};

const refOf = (value: unknown): string | undefined => {
	if (!isPlainObject(value) || Object.keys(value).length !== 1) {
		return undefined;
	}

	const ref = own(value, "ref");

	return typeof ref === "string" ? ref : undefined;
};

type ValueNode = { field: string; op: ConditionOperator; value: unknown };

const equalNode = (field: string, raw: unknown, scope: string): ValueNode => {
	return {
		field,
		op: ConditionOperator.Equal,
		value: normalizeConditionValue(raw, scope, field),
	};
};

export const fieldNode = (
	field: string,
	raw: unknown,
	scope: string,
): ValueNode => {
	const operator = asOperator(raw, scope, field);

	return operator === null
		? equalNode(field, raw, scope)
		: { field, ...operator };
};

export const comparisonNode = (
	field: string,
	raw: unknown,
): ValueNode | RefNode<Row> => {
	const operator = asOperator(raw, "where", field);

	if (operator === null) {
		return equalNode(field, raw, "where");
	}

	if (isRefOperator(operator.op)) {
		const ref = refOf(operator.value);

		if (ref !== undefined) {
			return { field, op: operator.op, ref };
		}
	}

	return { field, ...operator };
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
