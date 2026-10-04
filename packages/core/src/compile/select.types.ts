import type { Reach } from "./reads.js";
import type { CompiledRule } from "./rule.types.js";

export type RulesByEffect = {
	allow: readonly CompiledRule[];
	deny: readonly CompiledRule[];
	rowDeny: readonly CompiledRule[];
	reaches: readonly Reach[];
};

export type Select = (action: string, resource: string) => RulesByEffect;
