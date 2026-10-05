import { type Env, RuleEffect } from "../model/index.js";
import { own } from "../shared/index.js";
import { evaluateOperator } from "../verdict/index.js";
import { compileMatcher, type LeafOf } from "./matcher.js";
import type { CompiledRule } from "./rule.types.js";
import { rulesByEffectOf } from "./select.js";
import type { RulesByEffect, WhenState } from "./select.types.js";

const envLeaf: LeafOf = (node) => (env: Env) => {
	const actual = own(env, node.field);

	return actual === undefined
		? undefined
		: evaluateOperator(node.op, actual, node.value);
};

const stateOf = (rulesByEffect: RulesByEffect): WhenState | null => {
	if (rulesByEffect.when !== undefined) {
		return rulesByEffect.when;
	}

	const entries = [...rulesByEffect.allow, ...rulesByEffect.deny].flatMap(
		(compiled) => {
			const when = own(compiled.rule, "when");

			return when === undefined
				? []
				: [{ compiled, match: compileMatcher(when, envLeaf) }];
		},
	);

	const state: WhenState | null =
		entries.length === 0 ? null : { entries, last: undefined };

	rulesByEffect.when = state;

	return state;
};

export const resolveWhen = (
	rulesByEffect: RulesByEffect,
	env: Env,
): RulesByEffect => {
	const state = stateOf(rulesByEffect);

	if (state === null) {
		return rulesByEffect;
	}

	if (state.last?.[0] === env) {
		return state.last[1];
	}

	const dropped = new Set<CompiledRule>();

	for (const entry of state.entries) {
		const verdict = entry.match(env);
		const isAllow = entry.compiled.rule.effect === RuleEffect.Allow;

		if (verdict !== true && (isAllow || verdict === false)) {
			dropped.add(entry.compiled);
		}
	}

	const kept = (rules: readonly CompiledRule[]): CompiledRule[] => {
		return rules.filter((rule) => !dropped.has(rule));
	};

	const resolved =
		dropped.size === 0
			? rulesByEffect
			: rulesByEffectOf(
					kept(rulesByEffect.allow),
					kept(rulesByEffect.deny),
					null,
				);

	state.last = [env, resolved];

	return resolved;
};
