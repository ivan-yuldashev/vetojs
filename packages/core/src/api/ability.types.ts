import type { ConditionNode, Rule } from "../model/index.js";
import type { CheckedRules } from "./checked-rules.types.js";
import type {
	ActionFor,
	ResourceMap,
	ResourceName,
	ShapeOf,
} from "./define-abilities.types.js";
import type { PayloadResult, PayloadViolation } from "./mutation.types.js";
import type { ValidateResult } from "./schema.types.js";

/**
 * The object you ask questions of. Every method is bound to your resource declarations,
 * so the action, the resource and the row shape are all checked as you type.
 *
 * Built by {@link buildAbility}. Holds no state and mutates nothing.
 */
export type AbilitySet<AC extends ResourceMap = ResourceMap> = {
	/**
	 * The rules this ability was built from — plain JSON, ready to send to the client
	 * and hand to `<AbilityProvider rules={…}>`.
	 */
	readonly rules: CheckedRules;

	/**
	 * May this action happen?
	 *
	 * With an instance the answer is exact. Without one it is optimistic — *could* this be
	 * allowed for some row — which is what UI gating needs before a row exists. Never use
	 * the instance-less form to guard an operation that touches a specific row.
	 *
	 * @example
	 * ability.can("update", "post", post); // exact
	 * ability.can("create", "post");       // show the button?
	 */
	can<R extends ResourceName<AC>>(
		action: ActionFor<AC, R>,
		resource: R,
		instance?: ShapeOf<AC, R>,
	): boolean;

	/** The negation of {@link AbilitySet.can}. */
	cannot<R extends ResourceName<AC>>(
		action: ActionFor<AC, R>,
		resource: R,
		instance?: ShapeOf<AC, R>,
	): boolean;

	/**
	 * Like {@link AbilitySet.can}, but throws {@link ForbiddenError} instead of returning
	 * `false`. Use it at a server boundary and let an error boundary turn it into a 403.
	 *
	 * The instance is optional, mirroring `can`: omit it to guard an action that has no
	 * row yet.
	 *
	 * @throws {ForbiddenError} when the action is not allowed.
	 */
	authorize<R extends ResourceName<AC>>(
		action: ActionFor<AC, R>,
		resource: R,
		instance?: ShapeOf<AC, R>,
	): void;

	/**
	 * May this row be written? The same decision as `can` with an instance — the row half
	 * of a write check. The value half is {@link AbilitySet.validatePayload}.
	 */
	canMutate<R extends ResourceName<AC>>(
		action: ActionFor<AC, R>,
		resource: R,
		row: Partial<ShapeOf<AC, R>>,
	): boolean;

	/**
	 * May *this data* be written to *this row*? Checks the incoming keys against the
	 * permitted fields and values, and reports every violation instead of silently
	 * dropping keys.
	 *
	 * Only keys present in `data` are examined, so a PATCH need not send the rest.
	 *
	 * @returns `{ ok: true, data }` with the validated copy, or `{ ok: false, violations }`.
	 */
	validatePayload<R extends ResourceName<AC>>(
		action: ActionFor<AC, R>,
		resource: R,
		row: Partial<ShapeOf<AC, R>>,
		data: Partial<ShapeOf<AC, R>>,
	): PayloadResult<ShapeOf<AC, R>>;

	/**
	 * The condition for a database query — hand it to an adapter to fetch only the rows
	 * this actor may see. The filter selects exactly the rows `can()` would allow.
	 *
	 * @example
	 * db.select().from(posts).where(schema.filter(ability, "read", "post"));
	 */
	where<R extends ResourceName<AC>>(
		action: ActionFor<AC, R>,
		resource: R,
	): ConditionNode<ShapeOf<AC, R>>;

	/**
	 * Which of `fields` may this actor write — for driving a form. You pass the field
	 * universe because a schema cannot be asked for its keys, and what comes back is a
	 * subset of it, typed as one: ask about `["status"]` and the result is `"status"[]`.
	 *
	 * A disabled input is a courtesy; the server still enforces with `validatePayload`.
	 */
	permittedFields<R extends ResourceName<AC>, F extends keyof ShapeOf<AC, R>>(
		action: ActionFor<AC, R>,
		resource: R,
		fields: F[],
	): F[];

	/**
	 * Does incoming data match the resource's schema? Shape validation, not permission —
	 * the other half of handling untrusted input.
	 *
	 * Only does real work when the resource was declared with a Standard Schema; a
	 * phantom `shape<T>()` still rejects non-objects but cannot check fields.
	 */
	validate<R extends ResourceName<AC>>(
		resource: R,
		data: unknown,
	): ValidateResult<ShapeOf<AC, R>>;
};

/**
 * One access decision, as it happened.
 *
 * `rule` is the rule that settled it: the `deny` that fired, or the `allow` that granted.
 * It is absent when nothing matched and the default denied.
 *
 * A payload decision names no rule — a refusal there is settled field by field — and carries
 * `violations` instead, which is what tells an attempted field substitution apart from an
 * ordinary refusal in a log. **An empty `violations` array is still a refusal:** the write
 * was turned down as a whole, because no `allow` covered it or a blanket `deny` did, so
 * there was no field left to name.
 *
 * `reason` appears when the refusal never reached the rules at all.
 *
 * Neither the row nor the data is here. Field names are, in `violations`; values are not,
 * because a decision log is not the place they belong by default. Both are in scope where
 * you build the hook, so a log that wants them can close over them.
 */
export type DecisionReport = {
	action: string;
	resource: string;
	allowed: boolean;
	rule?: Rule;
	violations?: PayloadViolation[];
	reason?: "no row";
};

/**
 * Extras for {@link buildAbility}.
 */
export type AbilityOptions = {
	/**
	 * Called after every access decision — `can`, `cannot`, `authorize`, `canMutate` and
	 * `validatePayload` — with what was asked and what was answered.
	 *
	 * Not called for `where`, `permittedFields` or `validate`: those ask what a policy
	 * says, not whether an actor may act. Build the ability per actor and the hook's
	 * closure has the actor; nothing is threaded through the call.
	 *
	 * Whatever it throws reaches your caller, so keep it to recording.
	 */
	onDecision?: (decision: DecisionReport) => void;
};
