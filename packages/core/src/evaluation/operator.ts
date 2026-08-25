import { ConditionOperator, NUMERIC_TYPES } from "../shared/index.js";
import {
	kleeneAndOver,
	kleeneNot,
	kleeneOrOver,
	type Verdict,
} from "./verdict.js";

const normalize = (value: unknown): number | string | bigint | undefined => {
	if (typeof value === "string" || typeof value === "bigint") {
		return value;
	}

	if (typeof value === "number") {
		return Number.isNaN(value) ? undefined : value;
	}

	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isNaN(time) ? undefined : time;
	}

	return undefined;
};

const isPresent = (value: unknown): boolean => {
	return value !== undefined && value !== null;
};

const isObjectLike = (value: unknown): boolean => {
	return (
		typeof value === "object" && value !== null && !(value instanceof Date)
	);
};

type OrderableKind = "number" | "string" | "other";

const orderableKind = (value: unknown): OrderableKind => {
	if (NUMERIC_TYPES.includes(typeof value) || value instanceof Date) {
		return "number";
	}

	if (typeof value === "string") {
		return "string";
	}

	return "other";
};

const compareSign = (left: number | string | bigint, right: typeof left) => {
	if (left < right) {
		return -1;
	}

	if (left > right) {
		return 1;
	}

	return 0;
};

const ordered = (
	actual: unknown,
	expected: unknown,
	satisfies: (sign: number) => boolean,
): Verdict => {
	if (!isPresent(actual) || !isPresent(expected)) {
		return false;
	}

	const kind = orderableKind(actual);

	if (kind !== orderableKind(expected) || kind === "other") {
		return undefined;
	}

	const left = normalize(actual);
	const right = normalize(expected);

	if (left === undefined || right === undefined) {
		return false;
	}

	return satisfies(compareSign(left, right));
};

const equals = (a: unknown, b: unknown): boolean => {
	if (a instanceof Date && b instanceof Date) {
		return a.getTime() === b.getTime();
	}

	if (a instanceof Date && typeof b === "number") {
		return a.getTime() === b;
	}

	if (typeof a === "number" && b instanceof Date) {
		return a === b.getTime();
	}

	if (typeof a === "bigint" && typeof b === "number") {
		return Number.isInteger(b) && a === BigInt(b);
	}

	if (typeof a === "number" && typeof b === "bigint") {
		return Number.isInteger(a) && BigInt(a) === b;
	}

	return a === b;
};

const equalsVerdict = (actual: unknown, expected: unknown): Verdict => {
	if (
		isPresent(actual) &&
		isPresent(expected) &&
		(isObjectLike(actual) || isObjectLike(expected))
	) {
		return undefined;
	}

	return equals(actual, expected);
};

const memberVerdict = (actual: unknown, expected: unknown): Verdict => {
	if (!Array.isArray(expected)) {
		return undefined;
	}

	let sawUndefined = false;

	for (const item of expected) {
		const verdict = equalsVerdict(actual, item);

		if (verdict === true) {
			return true;
		}

		if (verdict === undefined) {
			sawUndefined = true;
		}
	}

	return sawUndefined ? undefined : false;
};

const containsVerdict = (actual: unknown, expected: unknown): Verdict => {
	if (typeof expected !== "string" || !isPresent(actual)) {
		return false;
	}

	return typeof actual === "string" ? actual.includes(expected) : undefined;
};

const overElements = (
	actual: unknown,
	decide: (elements: readonly unknown[]) => Verdict,
): Verdict => {
	if (Array.isArray(actual)) {
		return decide(actual);
	}

	return isPresent(actual) ? undefined : false;
};

const memberOf = (item: unknown, elements: readonly unknown[]): Verdict => {
	return memberVerdict(item, elements);
};

const overWanted = (
	actual: unknown,
	expected: unknown,
	fold: typeof kleeneAndOver,
): Verdict => {
	if (!Array.isArray(expected)) {
		return undefined;
	}

	return overElements(actual, (elements) => fold(expected, memberOf, elements));
};

export const evaluateOperator = (
	operator: ConditionOperator,
	actual: unknown,
	expected: unknown,
): Verdict => {
	switch (operator) {
		case ConditionOperator.Equal:
			return equalsVerdict(actual, expected);
		case ConditionOperator.NotEqual:
			return kleeneNot(equalsVerdict(actual, expected));
		case ConditionOperator.In:
			return memberVerdict(actual, expected);
		case ConditionOperator.NotIn:
			return kleeneNot(memberVerdict(actual, expected));
		case ConditionOperator.GreaterThan:
			return ordered(actual, expected, (sign) => sign > 0);
		case ConditionOperator.GreaterThanOrEqual:
			return ordered(actual, expected, (sign) => sign >= 0);
		case ConditionOperator.LessThan:
			return ordered(actual, expected, (sign) => sign < 0);
		case ConditionOperator.LessThanOrEqual:
			return ordered(actual, expected, (sign) => sign <= 0);
		case ConditionOperator.Contains:
			return containsVerdict(actual, expected);
		case ConditionOperator.Exists:
			return isPresent(actual) === Boolean(expected);
		case ConditionOperator.Has:
			return overElements(actual, (elements) =>
				memberVerdict(expected, elements),
			);
		case ConditionOperator.HasAny:
			return overWanted(actual, expected, kleeneOrOver);
		case ConditionOperator.HasAll:
			return overWanted(actual, expected, kleeneAndOver);
		default: {
			operator satisfies never;
			return undefined;
		}
	}
};
