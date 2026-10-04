import type { Rule } from "./rule.js";

declare const checked: unique symbol;

/**
 * A rule that provably passed a check — from {@link createRules}, verified by the compiler,
 * or {@link parseRules}, verified at runtime. {@link buildAbility} accepts nothing else, so
 * rules arriving from a database or the network cannot skip validation.
 *
 * The mark is phantom and unforgeable: it is never written at runtime, and its value is a
 * symbol this module does not export, so a hand-written literal cannot carry one. Reaching
 * past the check takes a visible `as CheckedRules`.
 */
export type CheckedRule = Rule & { readonly "~veto.checked": typeof checked };

/** A whole policy: the checked rules for one actor. */
export type CheckedRules = CheckedRule[];
