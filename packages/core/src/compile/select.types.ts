import type { Env } from "../model/index.js";
import type { Matcher } from "../verdict/index.js";
import type { Reach } from "./reads.js";
import type { CompiledRule } from "./rule.types.js";

type WhenEntry = { compiled: CompiledRule; match: Matcher };

export type WhenState = {
	entries: readonly WhenEntry[];
	last: [env: Env, resolved: RulesByEffect] | undefined;
};

export type RulesByEffect = {
	allow: readonly CompiledRule[];
	deny: readonly CompiledRule[];
	rowDeny: readonly CompiledRule[];
	reaches: readonly Reach[];
	when: WhenState | null | undefined;
};

export type Select = (action: string, resource: string) => RulesByEffect;
