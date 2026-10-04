import type { Rule } from "../model/index.js";
import type { Verdict } from "../verdict/index.js";

export type CheckResult = {
	verdict: Verdict;
	allowRule: Rule | undefined;
	denyRule: Rule | undefined;
	reason?: "not a plain row";
};

export type Wheres = { allow: Verdict[]; deny: Verdict[] };
