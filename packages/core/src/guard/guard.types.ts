import type { Ability, Decision } from "../api/index.js";
import type {
	DeclaredAction,
	ResourceMap,
	ResourceName,
	ShapeOf,
} from "../create/index.js";
import type { ForbiddenError } from "../errors/index.js";
import type { CheckedRules } from "../model/index.js";

type Awaitable<T> = T | Promise<T>;

export type GuardOptions = {
	action: string;
	resource: string;
	load?: (...args: unknown[]) => unknown;
	payload?: (...args: unknown[]) => Record<string, unknown>;
};

/**
 * Configured once per app; each action then only says what it acts on.
 */
export type GuardConfig<AC extends ResourceMap, Actor> = {
	/** Your {@link defineAbilities} declarations. */
	ac: AC;

	/**
	 * How to find the current user — cookies, session, headers.
	 *
	 * Return `null` (or `undefined`) when there is nobody signed in; the guard then calls
	 * {@link GuardConfig.onUnauthenticated} instead of building a policy for a non-user.
	 */
	getActor: () => Awaitable<Actor | null | undefined>;

	/** The actor → rules function. Never called without an actor. */
	policy: (actor: Actor) => CheckedRules;

	/**
	 * What to do when nobody is signed in. Must not return — throw, `redirect()`, or
	 * answer with a 401.
	 *
	 * Receives what was attempted, since {@link GuardConfig.onDecision} cannot report it:
	 * there is no actor, so no policy and no decision. It is the only place an attempt
	 * without a session can be logged.
	 *
	 * Without it, an absent actor is treated as an actor with no rules: the check fails
	 * and you get the usual {@link ForbiddenError}. That is safe, but it reports 403
	 * where 401 is the honest answer — which is why REST handlers will want this hook.
	 *
	 * @example
	 * onUnauthenticated: ({ action, resource }) => {
	 * 	log.warn(`401 on ${action} ${resource}`);
	 * 	throw new Response(null, { status: 401 });
	 * }
	 */
	onUnauthenticated?: (attempt: { action: string; resource: string }) => never;

	/** What to do when the actor is known but not allowed. Must not return. */
	onDeny?: (error: ForbiddenError) => never;

	/**
	 * Called after every access decision the guarded action makes, with what was asked,
	 * what was answered and the rule that settled it — see {@link Decision}.
	 *
	 * The actor comes second because this hook is configured once while the actor is
	 * resolved per call, so a closure could not have it.
	 *
	 * A hook that throws refuses the guarded action: the exception reaches your caller
	 * instead of the handler, and it is not a {@link ForbiddenError}, so `onDeny` does
	 * not run. Catch inside the hook when telemetry must not block an action.
	 */
	onDecision?: (decision: Decision, actor: Actor) => void;
};

/**
 * What one guarded action declares: the decision to make, and how to get the row and the
 * payload out of the arguments it is called with.
 *
 * Both callbacks receive the wrapped function's own arguments, so they take the same
 * parameter list even when one of them ignores part of it.
 */
export type ActionOptions<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
	Args extends unknown[],
> = {
	action: DeclaredAction<AC, R>;
	resource: R;

	/**
	 * How to fetch the row this call acts on.
	 *
	 * May come back empty — a `findFirst` that matched nothing, an id belonging to someone
	 * else — and the guard refuses, reporting `reason: "no row"`. That is why the handler's
	 * `ctx.row` is a row and not a maybe-row: reaching it is proof one was found.
	 */
	load?: (...args: Args) => Awaitable<ShapeOf<AC, R> | null | undefined>;
	payload?: (...args: Args) => Partial<ShapeOf<AC, R>>;
};

type Provided = (...args: never) => unknown;

/**
 * What the handler is handed once the check has passed.
 *
 * `row` and `payload` are optional only when the action left `load` or `payload` out:
 * declare one and the handler gets the value itself, not a maybe-value. `payload` is the
 * validated copy, so a field the actor may not write cannot reach your database call.
 */
export type GuardContext<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
	Actor,
	O = ActionOptions<AC, R, never[]>,
> = {
	actor: Actor;
	ability: Ability<AC>;
	row: O extends { load: Provided }
		? ShapeOf<AC, R>
		: ShapeOf<AC, R> | undefined;
	payload: O extends { payload: Provided }
		? Partial<ShapeOf<AC, R>>
		: Partial<ShapeOf<AC, R>> | undefined;
};

/**
 * What {@link createGuard} returns: wrap a handler, get a function with the same signature
 * that checks before it runs.
 */
export type WithPermission<AC extends ResourceMap, Actor> = <
	R extends ResourceName<AC>,
	Args extends unknown[],
	Result,
	O extends ActionOptions<AC, R, Args>,
>(
	options: O & ActionOptions<AC, R, Args>,
	handler: (
		ctx: GuardContext<AC, R, Actor, O>,
		...args: Args
	) => Awaitable<Result>,
) => (...args: Args) => Promise<Result>;
