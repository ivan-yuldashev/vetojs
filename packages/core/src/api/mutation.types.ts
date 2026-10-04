import type { Violation } from "../errors/index.js";

/** Public name for a payload violation; the shape ForbiddenError also carries. */
export type PayloadViolation = Violation;

/**
 * What {@link Ability.validatePayload} answers: the validated copy, or every field it
 * refused. The copy carries only the keys that were sent, so a PATCH stays a PATCH.
 */
export type PayloadResult<T> =
	| { ok: true; data: Partial<T> }
	| { ok: false; violations: PayloadViolation[] };
