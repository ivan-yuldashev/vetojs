import type { ConditionNode, Row } from "../model/index.js";
import { only } from "../shared/index.js";
import type { CompiledRule } from "./rule.types.js";
import type { RulesByEffect } from "./select.types.js";
import { everything, nothing } from "./vacuous.js";

type Conditioned = Pick<CompiledRule, "where">;

const orOf = (subset: readonly Conditioned[]): ConditionNode<Row> => {
	const conditions = subset.flatMap((compiled) => {
		const { where } = compiled;

		return where === undefined ? [] : [where];
	});

	return only(conditions) ?? { or: conditions };
};

const compileWhere = (
	allow: readonly Conditioned[],
	deny: readonly Conditioned[],
): ConditionNode<Row> => {
	if (allow.length === 0) {
		return nothing();
	}

	if (deny.some((compiled) => compiled.where === undefined)) {
		return nothing();
	}

	const hasUnconditional = allow.some(
		(compiled) => compiled.where === undefined,
	);

	const allowed = hasUnconditional ? everything() : orOf(allow);

	if (deny.length === 0) {
		return allowed;
	}

	const notDenied: ConditionNode<Row> = { not: orOf(deny) };

	return hasUnconditional ? notDenied : { and: [allowed, notDenied] };
};

export const whereOf = (selected: RulesByEffect): ConditionNode<Row> => {
	return compileWhere(selected.allow, selected.rowDeny);
};
