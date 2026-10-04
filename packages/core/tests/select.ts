import type { Ability, Decision } from "../src/api/index.js";
import { buildAbility } from "../src/api/index.js";
import type {
	CheckedRules,
	ConditionNode,
	Row,
	Rule,
} from "../src/model/index.js";

export type Selected = {
	ability: Ability;
	decided: () => Decision | undefined;
	action: string;
	resource: string;
	where: ConditionNode<Row>;
};

export type Settled = Omit<Decision, "action" | "resource">;

export const select = <T extends Row>(
	rules: readonly Rule<T>[],
	action: string,
	resource: string,
): Selected => {
	let last: Decision | undefined;
	const ability: Ability = buildAbility({}, rules as unknown as CheckedRules, {
		onDecision: (decision) => {
			last = decision;
		},
	});

	return {
		ability,
		decided: () => last,
		action,
		resource,
		where: ability.where(action, resource),
	};
};

const settled = (selected: Selected): Settled => {
	const decision = selected.decided();

	if (decision === undefined) {
		throw new Error("the ability reported no decision");
	}

	const { action: _action, resource: _resource, ...rest } = decision;

	return rest;
};

export const evaluateRules = (selected: Selected, row: unknown): Settled => {
	if (row === undefined) {
		return { allowed: false, reason: "not a plain row" };
	}

	selected.ability.can(selected.action, selected.resource, row as Row);

	return settled(selected);
};

export const canMutate = (selected: Selected, row: unknown): Settled => {
	selected.ability.canMutate(
		selected.action,
		selected.resource,
		row as Row | undefined,
	);

	return settled(selected);
};

export const permittedFields = <F extends string>(
	selected: Selected,
	fields: readonly F[],
): F[] => {
	return selected.ability.permittedFields(
		selected.action,
		selected.resource,
		undefined,
		[...fields],
	) as F[];
};

export const validatePayload = (
	selected: Selected,
	row: unknown,
	data: unknown,
) => {
	return selected.ability.validatePayload(
		selected.action,
		selected.resource,
		row as Row | undefined,
		data as Row,
	);
};
