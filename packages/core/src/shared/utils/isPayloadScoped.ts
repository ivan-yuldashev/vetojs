import { saysNothing } from "./saysNothing.js";

export const isPayloadScoped = (rule: {
	payload?: { fields?: unknown; constraints?: unknown };
}): boolean => {
	if (rule.payload?.fields !== undefined) {
		return true;
	}

	const constraints = rule.payload?.constraints;

	return constraints !== undefined && !saysNothing(constraints);
};
