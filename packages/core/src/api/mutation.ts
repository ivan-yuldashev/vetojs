import {
	evaluateOperator,
	evaluateRules,
	kleeneAndOver,
	ruleMatches,
	ruleWhereVerdict,
	type Settled,
	type Verdict,
} from "../evaluation/index.js";
import type { ConditionNode, Rule } from "../model/index.js";
import {
	type ConditionOperator,
	isPayloadScoped,
	isPlainObject,
	owns,
	type Row,
	RuleEffect,
} from "../shared/index.js";
import type { PayloadResult, PayloadViolation } from "./mutation.types.js";

export const canMutate = <T extends Row>(
	rules: Rule<T>[],
	action: string,
	resource: string,
	row: unknown,
	settled?: Settled<T>,
): boolean => evaluateRules(rules, action, resource, row, settled);

const isProtoKey = (field: PropertyKey): boolean => {
	return (
		field === "__proto__" || field === "constructor" || field === "prototype"
	);
};

export const permittedFields = <T extends Row>(
	rules: Rule<T>[],
	action: string,
	resource: string,
	fields: (keyof T)[],
): (keyof T)[] => {
	const matched = rules.filter((rule) => ruleMatches(rule, action, resource));
	const allows = matched.filter((rule) => rule.effect === RuleEffect.Allow);

	if (allows.length === 0) {
		return [];
	}

	const denies = matched.filter((rule) => rule.effect === RuleEffect.Deny);

	if (
		denies.some((rule) => rule.where === undefined && !isPayloadScoped(rule))
	) {
		return [];
	}

	const allowsAll = allows.some((rule) => rule.payload?.fields === undefined);

	const allowFields = new Set<keyof T>(
		allows.flatMap((rule) => rule.payload?.fields ?? []),
	);

	const denyFields = new Set<keyof T>(
		denies.flatMap((rule) => rule.payload?.fields ?? []),
	);

	return fields.filter((field) => {
		if (denyFields.has(field)) {
			return false;
		}

		return !isProtoKey(field) && (allowsAll || allowFields.has(field));
	});
};

const fieldsOf = <T extends Row>(rules: Rule<T>[]) => {
	return rules.flatMap((rule) => rule.payload?.fields ?? []);
};

type FieldConstraint = {
	field: string;
	op: ConditionOperator;
	value: unknown;
};

const fieldConstraints = <T extends Row>(
	constraint: ConditionNode<T>,
): FieldConstraint[] | null => {
	if (owns(constraint, "and")) {
		const collected: FieldConstraint[] = [];

		for (const child of constraint.and) {
			const childConstraints = fieldConstraints(child);

			if (childConstraints === null) {
				return null;
			}

			collected.push(...childConstraints);
		}

		return collected;
	}

	if (owns(constraint, "field") && typeof constraint.field === "string") {
		return [
			{
				field: constraint.field,
				op: constraint.op,
				value: constraint.value,
			},
		];
	}

	return null;
};

const holds = (constraint: FieldConstraint, value: unknown): Verdict => {
	return evaluateOperator(constraint.op, value, constraint.value);
};

const constraintsHold = (
	constraints: FieldConstraint[],
	value: unknown,
): Verdict => {
	return kleeneAndOver(constraints, holds, value);
};

const getFieldConstraintsForRule = <T extends Row>(
	rule: Rule<T>,
	targetField: string,
): FieldConstraint[] | null => {
	if (!rule.payload?.constraints) {
		return [];
	}

	const all = fieldConstraints(rule.payload.constraints);

	if (all === null) {
		return null;
	}

	return all.filter((constraint) => constraint.field === targetField);
};

export const validatePayload = <T extends Row>(
	rules: Rule<T>[],
	action: string,
	resource: string,
	row: unknown,
	data: unknown,
): PayloadResult<T> => {
	if (!isPlainObject<T>(row) || !isPlainObject<Partial<T>>(data)) {
		return { ok: false, violations: [] };
	}

	const allows = rules.filter(
		(rule) =>
			rule.effect === RuleEffect.Allow &&
			ruleWhereVerdict(rule, action, resource, row) === true,
	);

	if (allows.length === 0) {
		return { ok: false, violations: [] };
	}

	const denies = rules.filter(
		(rule) =>
			rule.effect === RuleEffect.Deny &&
			ruleWhereVerdict(rule, action, resource, row) !== false,
	);

	const vetoed = denies.some((rule) => !isPayloadScoped(rule));

	if (vetoed) {
		return { ok: false, violations: [] };
	}

	const allowsAll = allows.some((rule) => rule.payload?.fields === undefined);
	const allowFields = new Set(fieldsOf(allows));
	const denyFields = new Set(fieldsOf(denies));

	const violations: PayloadViolation[] = [];

	for (const [field, value] of Object.entries(data)) {
		const allowedByFields =
			!isProtoKey(field) && (allowsAll || allowFields.has(field));

		if (!allowedByFields || denyFields.has(field)) {
			violations.push({ field, reason: "field not permitted" });
			continue;
		}

		const isDeniedByValue = denies.some((rule) => {
			const ruleConstraints = getFieldConstraintsForRule(rule, field);

			if (ruleConstraints === null) {
				return true;
			}

			return (
				ruleConstraints.length > 0 &&
				constraintsHold(ruleConstraints, value) !== false
			);
		});

		if (isDeniedByValue) {
			violations.push({ field, reason: "value denied" });
			continue;
		}

		const isAllowedByValue = allows.some((rule) => {
			if (rule.payload?.fields && !rule.payload.fields.includes(field)) {
				return false;
			}

			const ruleConstraints = getFieldConstraintsForRule(rule, field);

			if (ruleConstraints === null) {
				return false;
			}

			return (
				ruleConstraints.length === 0 ||
				constraintsHold(ruleConstraints, value) === true
			);
		});

		if (!isAllowedByValue) {
			violations.push({ field, reason: "value not permitted" });
		}
	}

	if (violations.length > 0) {
		return { ok: false, violations };
	}

	return { ok: true, data: { ...data } };
};
