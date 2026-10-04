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

export const isOperator = (
	operator: unknown,
): operator is ConditionOperator => {
	return CONDITION_OPERATORS.some((known) => known === operator);
};
