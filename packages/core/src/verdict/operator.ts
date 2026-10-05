import { ConditionOperator } from "../model/index.js";
import { kleeneAndOver, kleeneNot, kleeneOrOver } from "./kleene.js";
import type { Verdict } from "./verdict.types.js";

const numberOf = (value: unknown): number | bigint | undefined => {
	const plain = value instanceof Date ? value.getTime() : value;

	if (typeof plain === "number") {
		return Number.isNaN(plain) ? undefined : plain;
	}

	return typeof plain === "bigint" ? plain : undefined;
};

const compare = (actual: unknown, expected: unknown): number | undefined => {
	const left = numberOf(actual);
	const right = numberOf(expected);

	if (left === undefined || right === undefined) {
		return undefined;
	}

	if (left < right) {
		return -1;
	}

	return left > right ? 1 : 0;
};

const ordered = (
	actual: unknown,
	expected: unknown,
	satisfies: (sign: number) => boolean,
): Verdict => {
	if (actual === null) {
		return false;
	}

	const sign = compare(actual, expected);

	return sign === undefined ? undefined : satisfies(sign);
};

const equalsVerdict = (actual: unknown, expected: unknown): Verdict => {
	if (actual === null || expected === null || expected === undefined) {
		return actual === expected;
	}

	if (
		typeof actual === typeof expected &&
		(typeof actual === "string" || typeof actual === "boolean")
	) {
		return actual === expected;
	}

	const sign = compare(actual, expected);

	return sign === undefined ? undefined : sign === 0;
};

const memberVerdict = (actual: unknown, expected: unknown): Verdict => {
	if (!Array.isArray(expected)) {
		return undefined;
	}

	let result: Verdict = false;

	for (const item of expected) {
		const verdict = equalsVerdict(actual, item);

		if (verdict === true) {
			return true;
		}

		if (verdict === undefined) {
			result = undefined;
		}
	}

	return result;
};

const containsVerdict = (actual: unknown, expected: unknown): Verdict => {
	if (typeof expected !== "string" || actual === null) {
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

	return actual === null ? false : undefined;
};

const overWanted = (
	actual: unknown,
	expected: unknown,
	fold: typeof kleeneAndOver,
): Verdict => {
	if (!Array.isArray(expected)) {
		return undefined;
	}

	return overElements(actual, (elements) =>
		fold(expected, memberVerdict, elements),
	);
};

export const evaluateOperator = (
	operator: ConditionOperator,
	actual: unknown,
	expected: unknown,
): Verdict => {
	if (actual === undefined) {
		return undefined;
	}

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
			return typeof expected === "boolean"
				? (actual !== null) === expected
				: undefined;
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
