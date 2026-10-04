import type { Rule } from "../model/index.js";
import { MANAGE_ACTION, RuleEffect } from "../model/index.js";
import { reachesOf } from "./reads.js";
import { compileRule } from "./rule.js";
import type { CompiledRule } from "./rule.types.js";
import type { RulesByEffect, Select } from "./select.types.js";

type Resource = {
	rules: Rule[];
	hasWildcard: boolean;
	byAction: Map<string, RulesByEffect>;
	wildcard: RulesByEffect | undefined;
};

const EMPTY_RULES_BY_EFFECT: RulesByEffect = {
	allow: [],
	deny: [],
	rowDeny: [],
	reaches: [],
};

const rulesByEffectOf = (
	allow: readonly CompiledRule[],
	deny: readonly CompiledRule[],
): RulesByEffect => {
	return {
		allow,
		deny,
		rowDeny: deny.filter((compiled) => !compiled.isFieldLevel),
		reaches: reachesOf([...allow, ...deny]),
	};
};

const names = (rule: Rule, action: string): boolean => {
	return Array.isArray(rule.action)
		? rule.action.includes(action)
		: rule.action === action;
};

const resourcesOf = (rules: readonly Rule[]): Map<string, Resource> => {
	const resources = new Map<string, Resource>();

	for (const rule of rules) {
		let resource = resources.get(rule.resource);

		if (resource === undefined) {
			resource = {
				rules: [],
				hasWildcard: false,
				byAction: new Map(),
				wildcard: undefined,
			};

			resources.set(rule.resource, resource);
		}

		resource.rules.push(rule);

		if (names(rule, MANAGE_ACTION)) {
			resource.hasWildcard = true;
		}
	}

	return resources;
};

const selectRules = (rules: readonly Rule[], action: string): RulesByEffect => {
	const allow: CompiledRule[] = [];
	const deny: CompiledRule[] = [];

	for (const rule of rules) {
		if (!names(rule, action) && !names(rule, MANAGE_ACTION)) {
			continue;
		}

		(rule.effect === RuleEffect.Allow ? allow : deny).push(compileRule(rule));
	}

	return rulesByEffectOf(allow, deny);
};

export const createSelect = (rules: readonly Rule[]): Select => {
	let resources: Map<string, Resource> | undefined;
	let lastAction = "";
	let lastResource = "";
	let last: RulesByEffect | undefined;

	const lookUp = (action: string, resource: string): RulesByEffect => {
		if (resources === undefined) {
			resources = resourcesOf(rules);
		}

		const entry = resources.get(resource);

		if (action === MANAGE_ACTION || entry === undefined) {
			return EMPTY_RULES_BY_EFFECT;
		}

		const known = entry.byAction.get(action);

		if (known !== undefined) {
			return known;
		}

		if (entry.rules.some((rule) => names(rule, action))) {
			const rulesByEffect = selectRules(entry.rules, action);

			entry.byAction.set(action, rulesByEffect);

			return rulesByEffect;
		}

		if (!entry.hasWildcard) {
			return EMPTY_RULES_BY_EFFECT;
		}

		if (entry.wildcard === undefined) {
			entry.wildcard = selectRules(entry.rules, MANAGE_ACTION);
		}

		return entry.wildcard;
	};

	return (action, resource) => {
		if (
			last !== undefined &&
			action === lastAction &&
			resource === lastResource
		) {
			return last;
		}

		last = lookUp(action, resource);
		lastAction = action;
		lastResource = resource;

		return last;
	};
};
