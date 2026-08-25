import type { Rule } from "../model/index.js";
import {
	isPayloadScoped,
	isPlainObject,
	MANAGE_ACTION,
	type Row,
	RuleEffect,
} from "../shared/index.js";
import type { Matcher } from "./compile.js";
import { evaluateCondition } from "./condition.js";
import type { Verdict } from "./verdict.js";

const actionMatches = (
	ruleAction: string | string[],
	action: string,
): boolean => {
	if (Array.isArray(ruleAction)) {
		return ruleAction.includes(MANAGE_ACTION) || ruleAction.includes(action);
	}

	return ruleAction === MANAGE_ACTION || ruleAction === action;
};

export const prohibitsRow = <T extends Row>(rule: Rule<T>): boolean => {
	return rule.effect === RuleEffect.Deny && !isPayloadScoped(rule);
};

export type Settled<T extends Row> = { rule?: Rule<T> };

export const ruleMatches = <T extends Row>(
	rule: Rule<T>,
	action: string,
	resource: string,
): boolean => {
	return rule.resource === resource && actionMatches(rule.action, action);
};

export const ruleWhereVerdict = <T extends Row>(
	rule: Rule<T>,
	action: string,
	resource: string,
	instance: T,
): Verdict => {
	if (!ruleMatches(rule, action, resource)) {
		return false;
	}

	return rule.where === undefined
		? true
		: evaluateCondition(rule.where, instance);
};

export type Prepared = {
	grantIsFinal: boolean;
	matchers: (Matcher | undefined)[];
};

export const evaluateRules = <T extends Row>(
	rules: Rule<T>[],
	action: string,
	resource: string,
	instance: unknown,
	settled?: Settled<T>,
	prepared?: Prepared,
): boolean => {
	let allowed = false;

	if (!isPlainObject<T>(instance)) {
		return allowed;
	}

	const matchers = prepared?.matchers;
	const grantIsFinal = prepared?.grantIsFinal ?? false;

	for (let index = 0; index < rules.length; index++) {
		const rule = rules[index];

		if (rule === undefined) {
			continue;
		}

		if (allowed && rule.effect !== RuleEffect.Deny) {
			continue;
		}

		const isDeny = rule.effect === RuleEffect.Deny;

		if (isDeny && !prohibitsRow(rule)) {
			continue;
		}

		const matcher = matchers?.[index];

		const verdict =
			matcher === undefined
				? ruleWhereVerdict(rule, action, resource, instance)
				: matcher(instance);

		if (isDeny && verdict !== false) {
			if (settled) {
				settled.rule = rule;
			}

			return false;
		}

		if (!isDeny && verdict === true) {
			allowed = true;

			if (settled && settled.rule === undefined) {
				settled.rule = rule;
			}

			if (grantIsFinal) {
				return true;
			}
		}
	}

	return allowed;
};

export const mightAllow = <T extends Row>(
	rules: Rule<T>[],
	action: string,
	resource: string,
	settled?: Settled<T>,
): boolean => {
	let hasAllow = false;

	for (const rule of rules) {
		if (!ruleMatches(rule, action, resource)) {
			continue;
		}

		if (
			rule.effect === RuleEffect.Deny &&
			rule.where === undefined &&
			!isPayloadScoped(rule)
		) {
			if (settled) {
				settled.rule = rule;
			}

			return false;
		}

		if (rule.effect !== RuleEffect.Deny) {
			hasAllow = true;

			if (settled && settled.rule === undefined) {
				settled.rule = rule;
			}
		}
	}

	return hasAllow;
};
