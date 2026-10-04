import type {
	DeclaredAction,
	FieldName,
	ResourceMap,
	ResourceName,
	ShapeOf,
	ValidateResult,
} from "../create/index.js";
import type { CheckedRule, ConditionNode, Rule } from "../model/index.js";
import type { PayloadResult, PayloadViolation } from "./mutation.types.js";

/**
 * The object you ask questions of. Every method is bound to your resource declarations,
 * so the action, the resource and the row shape are all checked as you type.
 *
 * Built by {@link buildAbility}. Holds no state and mutates nothing.
 */
export type Ability<AC extends ResourceMap = ResourceMap> = {
	/**
	 * The rules this ability was built from — plain JSON, ready to send to the client
	 * and hand to `<AbilityProvider rules={…}>`.
	 */
	readonly rules: readonly CheckedRule[];

	/**
	 * May this action happen?
	 *
	 * With a row the answer is exact. Without one it is optimistic — *could* this be
	 * allowed for some row — which is what UI gating needs before a row exists. Never use
	 * the row-less form to guard an operation that touches a specific row.
	 *
	 * @example
	 * ability.can("update", "post", post); // exact
	 * ability.can("create", "post");       // show the button?
	 */
	can<R extends ResourceName<AC>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row?: ShapeOf<AC, R>,
	): boolean;

	/** The negation of {@link Ability.can}. */
	cannot<R extends ResourceName<AC>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row?: ShapeOf<AC, R>,
	): boolean;

	/**
	 * Like {@link Ability.can}, but throws {@link ForbiddenError} instead of returning
	 * `false`. Use it at a server boundary and let an error boundary turn it into a 403.
	 *
	 * The row is optional: omit it to guard an action that has no row yet. Without one it
	 * does not answer optimistically, as `can` does — it passes only when no row could change
	 * the answer: an `allow` with no `where` covers the action, and no `deny` reads the row.
	 *
	 * @throws {ForbiddenError} when the action is not allowed.
	 */
	authorize<R extends ResourceName<AC>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row?: ShapeOf<AC, R>,
	): void;

	/**
	 * May this row be written? The decision `can` makes on a row — the row half
	 * of a write check. The value half is {@link Ability.validatePayload}.
	 *
	 * Omit the row for a write that has none to load, such as a create. The answer then has
	 * to be decidable without a row: a rule that reads one — a permission or a prohibition —
	 * leaves the question open, and this is a deciding call, so an open question refuses.
	 */
	canMutate<R extends ResourceName<AC>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row?: Partial<ShapeOf<AC, R>>,
	): boolean;

	/**
	 * May *this data* be written to *this row*? Checks the incoming keys against the
	 * permitted fields and values, and reports every violation instead of silently
	 * dropping keys.
	 *
	 * Only keys present in `data` are examined, so a PATCH need not send the rest.
	 *
	 * Pass the whole row, as `can` takes it, or `undefined` for a write that has none —
	 * a create. Without a row the field and value levels still answer, while an `allow`
	 * conditioned on rows cannot be shown to apply and so does not grant. A candidate
	 * assembled from the request is not a row: judging row conditions by it asks the
	 * policy about data the caller supplied.
	 *
	 * Those are the only two shapes it takes, which is what keeps the row from being
	 * confused with `data` — hand the two over in the other order and it does not compile.
	 *
	 * @returns `{ ok: true, data }` with the validated copy, or `{ ok: false, violations }`.
	 */
	validatePayload<R extends ResourceName<AC>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row: ShapeOf<AC, R> | undefined,
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
		action: DeclaredAction<AC, R>,
		resource: R,
	): ConditionNode<ShapeOf<AC, R>>;

	/**
	 * Which of `fields` may this actor write — for driving a form. You pass the field
	 * universe because a schema cannot be asked for its keys, and what comes back is a
	 * subset of it, typed as one: ask about `["status"]` and the result is `"status"[]`.
	 *
	 * With the row the answer is exact, the one `validatePayload` gives for a field. Pass
	 * `undefined` where there is no row yet and the answer is optimistic, as it is for `can`:
	 * a field the rules cannot settle without a row stays in the list, and `validatePayload`
	 * refuses it once the row is known.
	 *
	 * A disabled input is a courtesy; the server still enforces with `validatePayload`.
	 */
	permittedFields<R extends ResourceName<AC>, F extends FieldName<AC, R>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row: ShapeOf<AC, R> | undefined,
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
 * It is absent when nothing matched and the default denied, and when a deciding call refused
 * because the answer waited on a row that was not passed: a condition speaks about a row, so
 * without one no rule refused. A `deny` that fires on data it could not compare, in a row that
 * was passed, is named: the row was there, and the deny read it. An optimistic `can` without a
 * row names the `allow` that could grant.
 *
 * A payload decision names no rule — a refusal there is settled field by field — and carries
 * `violations` instead, which is what tells an attempted field substitution apart from an
 * ordinary refusal in a log. **An empty `violations` array is still a refusal:** the write
 * was turned down as a whole, because no `allow` covered it or a blanket `deny` did, so
 * there was no field left to name.
 *
 * `reason` appears when the refusal never reached the rules at all: `"no row"` when the
 * guard could not load one, `"not a plain row"` when what was passed is an object the engine
 * will not read — a class row from an ORM, a `Date`, an array. The verdict is the usual
 * fail-closed `false`; the reason is there so the cause is not guessed at.
 *
 * Neither the row nor the data is here. Field names are, in `violations`; values are not,
 * because a decision log is not the place they belong by default. Both are in scope where
 * you build the hook, so a log that wants them can close over them.
 */
export type Decision = {
	action: string;
	resource: string;
	allowed: boolean;
	rule?: Rule;
	violations?: PayloadViolation[];
	reason?: "no row" | "not a plain row";
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
	 * The verdict is settled before the hook runs, so nothing it does can change the
	 * answer — but a hook that throws stops the call from handing that answer back, and
	 * your exception reaches the caller in its place, so none of the calls above hands
	 * back a grant it could not record. Catch inside your own hook when telemetry must
	 * not block a check.
	 *
	 * @example
	 * onDecision: (decision) => {
	 * 	try {
	 * 		audit(decision);
	 * 	} catch (error) {
	 * 		console.warn("veto: decision hook failed", error);
	 * 	}
	 * }
	 */
	onDecision?: (decision: Decision) => void;
};
