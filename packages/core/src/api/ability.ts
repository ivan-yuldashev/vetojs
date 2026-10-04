import { type CheckResult, checkRow } from "../check/index.js";
import { createSelect, type Select, whereOf } from "../compile/index.js";
import type { ResourceMap, ValidateResult } from "../create/index.js";
import { validateSchema } from "../create/index.js";
import { ForbiddenError } from "../errors/index.js";
import type { CheckedRule, ConditionNode, Row, Rule } from "../model/index.js";
import { isRow, own } from "../shared/index.js";
import type { Ability, AbilityOptions, Decision } from "./ability.types.js";
import { permittedFields, validatePayload } from "./mutation.js";
import type { PayloadResult } from "./mutation.types.js";

const ruleOf = (
	result: CheckResult,
	allowed: boolean,
	hasRow: boolean,
): Rule | undefined => {
	if (allowed) {
		return result.allowRule;
	}

	return result.verdict === false || hasRow ? result.denyRule : undefined;
};

const decisionOf = (
	action: string,
	resource: string,
	result: CheckResult,
	allowed: boolean,
	hasRow: boolean,
): Decision => {
	const decision: Decision = { action, resource, allowed };
	const rule = ruleOf(result, allowed, hasRow);

	if (rule !== undefined) {
		decision.rule = rule;
	}

	if (result.reason !== undefined) {
		decision.reason = result.reason;
	}

	return decision;
};

const payloadDecisionOf = (
	action: string,
	resource: string,
	row: Row | undefined,
	result: PayloadResult<Row>,
): Decision => {
	if (result.ok) {
		return { action, resource, allowed: true };
	}

	const decision: Decision = {
		action,
		resource,
		allowed: false,
		violations: result.violations,
	};

	if (row !== undefined && !isRow(row)) {
		decision.reason = "not a plain row";
	}

	return decision;
};

const abilityOf = (
	ac: ResourceMap,
	rules: readonly CheckedRule[],
	onDecision: AbilityOptions["onDecision"],
	select: Select,
): Ability => {
	const decide = (
		action: string,
		resource: string,
		row: Row | undefined,
		isOptimistic: boolean,
	): boolean => {
		const result = checkRow(
			select(action, resource),
			row,
			onDecision !== undefined,
		);

		const allowed = result.verdict ?? isOptimistic;

		onDecision?.(
			decisionOf(action, resource, result, allowed, row !== undefined),
		);

		return allowed;
	};

	const can = (action: string, resource: string, row?: Row): boolean => {
		return decide(action, resource, row, row === undefined);
	};

	const ability = {
		rules,
		can,
		cannot: (action: string, resource: string, row?: Row): boolean => {
			return !can(action, resource, row);
		},
		authorize: (action: string, resource: string, row?: Row): void => {
			if (!decide(action, resource, row, false)) {
				throw new ForbiddenError(action, resource);
			}
		},
		canMutate: (action: string, resource: string, row?: Row): boolean => {
			return decide(action, resource, row, false);
		},
		validatePayload: (
			action: string,
			resource: string,
			row: Row | undefined,
			data: unknown,
		): PayloadResult<Row> => {
			const result = validatePayload(select(action, resource), row, data);

			onDecision?.(payloadDecisionOf(action, resource, row, result));

			return result;
		},
		permittedFields: (
			action: string,
			resource: string,
			row: Row | undefined,
			fields: string[],
		): string[] => {
			return permittedFields(select(action, resource), row, fields);
		},
		where: (action: string, resource: string): ConditionNode<Row> => {
			return whereOf(select(action, resource));
		},
		validate: (resource: string, data: unknown): ValidateResult<Row> => {
			const definition = own(ac, resource);

			return definition === undefined
				? {
						ok: false,
						issues: [{ message: `unknown resource "${resource}"` }],
					}
				: validateSchema(own(definition, "schema"), data);
		},
	};

	return ability as Ability;
};

/**
 * Turns a policy into the object you call.
 *
 * Accepts only rules that provably passed a check — from {@link createRules} (verified by
 * the compiler) or {@link parseRules} (verified at runtime), so the validation step for
 * rules arriving from a database or the network cannot be skipped.
 *
 * The list is read once, here: adding to or removing from the array afterwards changes
 * nothing. The rule objects stay yours, so build again for a policy that changed rather
 * than editing one in place.
 *
 * @param ac - your {@link defineAbilities} declarations
 * @param policy - the rules for one actor
 *
 * @example
 * const ability = buildAbility(ac, policyFor(user));
 * ability.can("update", "post", post);
 */
export const buildAbility = <AC extends ResourceMap = ResourceMap>(
	ac: AC,
	policy: readonly CheckedRule[],
	options?: AbilityOptions,
): Ability<AC> => {
	const rules = [...policy];

	return abilityOf(
		ac,
		rules,
		options === undefined ? undefined : own(options, "onDecision"),
		createSelect(rules),
	);
};
