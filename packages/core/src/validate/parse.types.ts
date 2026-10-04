import type { Rule } from "../model/index.js";

/**
 * What {@link parseRules} answers: the rules, now checked, or every problem it found — each
 * with the path it sits at.
 */
export type RuleParseResult<Rules extends Rule[] = Rule[]> =
	| { ok: true; rules: Rules }
	| { ok: false; errors: string[] };
