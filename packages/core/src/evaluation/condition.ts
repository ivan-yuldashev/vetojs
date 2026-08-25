import type { ConditionNode } from "../model/index.js";
import type { Row } from "../shared/index.js";
import { matcherFor } from "./compile.js";
import type { Verdict } from "./verdict.js";

export const evaluateCondition = <T extends Row>(
	node: ConditionNode<T>,
	instance: T,
): Verdict => {
	if (instance === null || instance === undefined) {
		return false;
	}

	return matcherFor(node)(instance);
};
