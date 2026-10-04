import { buildAbility, type Decision } from "@vetojs/core";
import { createGuard } from "@vetojs/core/guard";
import { type Actor, ac, policyFor } from "@vetojs-examples/shared";
import { cache } from "react";
import { getActor } from "./auth";

const log = (decision: Decision, actor: Actor): void => {
	console.info(
		`[veto] ${actor.id.padEnd(6)} ${decision.action} ${decision.resource} → ${
			decision.allowed ? "allowed" : "denied"
		} by ${decision.rule === undefined ? "no rule" : JSON.stringify(decision.rule)}`,
	);
};

export const withPermission = createGuard({
	ac,
	getActor,
	policy: policyFor,
	onDecision: log,
});

export const getRules = cache(async () => policyFor(await getActor()));

export const getAbility = cache(async () => {
	const actor = await getActor();

	return buildAbility(ac, policyFor(actor), {
		onDecision: (decision) => log(decision, actor),
	});
});
