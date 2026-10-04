/** How a field condition compares its value. */
export const ConditionOperator = {
	Equal: "eq",
	NotEqual: "ne",
	In: "in",
	NotIn: "nin",
	GreaterThan: "gt",
	GreaterThanOrEqual: "gte",
	LessThan: "lt",
	LessThanOrEqual: "lte",
	Contains: "contains",
	Exists: "exists",
	Has: "has",
	HasAny: "hasAny",
	HasAll: "hasAll",
} as const;

export type ConditionOperator =
	(typeof ConditionOperator)[keyof typeof ConditionOperator];

export const CONDITION_OPERATORS: readonly ConditionOperator[] =
	Object.values(ConditionOperator);

export type RefOperator = (typeof ConditionOperator)[
	| "Equal"
	| "NotEqual"
	| "GreaterThan"
	| "GreaterThanOrEqual"
	| "LessThan"
	| "LessThanOrEqual"];

export const refOperators = (): readonly RefOperator[] => [
	ConditionOperator.Equal,
	ConditionOperator.NotEqual,
	ConditionOperator.GreaterThan,
	ConditionOperator.GreaterThanOrEqual,
	ConditionOperator.LessThan,
	ConditionOperator.LessThanOrEqual,
];

export const isRefOperator = (operator: unknown): operator is RefOperator => {
	return refOperators().some((known) => known === operator);
};

export const isOperator = (
	operator: unknown,
): operator is ConditionOperator => {
	return CONDITION_OPERATORS.some((known) => known === operator);
};
