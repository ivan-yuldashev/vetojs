import { ruleMatches } from "../evaluation/index.js";
import type { ConditionNode, Rule } from "../model/index.js";
import { isPayloadScoped, type Row, RuleEffect } from "../shared/index.js";
import { everything, nothing } from "./vacuous.js";

export const compileWhere = <T extends Row>(
	rules: Rule<T>[],
	action: string,
	resource: string,
): ConditionNode<T> => {
	const matched = rules.filter((rule) => ruleMatches(rule, action, resource));
	const allows = matched.filter((rule) => rule.effect === RuleEffect.Allow);
	const denies = matched.filter(
		(rule) => rule.effect === RuleEffect.Deny && !isPayloadScoped(rule),
	);

	if (allows.length === 0) {
		return nothing<ConditionNode<T>>();
	}

	if (denies.some((rule) => rule.where === undefined)) {
		return nothing<ConditionNode<T>>();
	}

	const orOf = (subset: Rule<T>[]): ConditionNode<T> => {
		const conditions = subset.flatMap((rule) =>
			rule.where ? [rule.where] : [],
		);

		const [first] = conditions;

		return conditions.length === 1 && first !== undefined
			? first
			: { or: conditions };
	};

	const allowUnconditional = allows.some((rule) => rule.where === undefined);
	const allowGroup = allowUnconditional
		? everything<ConditionNode<T>>()
		: orOf(allows);
	const denyGroup = denies.length === 0 ? undefined : orOf(denies);

	if (denyGroup === undefined) {
		return allowGroup;
	}

	const notDeny: ConditionNode<T> = { not: denyGroup };

	return allowUnconditional ? notDeny : { and: [allowGroup, notDeny] };
};
