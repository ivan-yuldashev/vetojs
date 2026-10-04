import type { Ability, Decision } from "../api/index.js";
import { bindEnv, build } from "../api/index.js";
import type { ResourceMap } from "../create/index.js";
import { ForbiddenError } from "../errors/index.js";
import type { Row } from "../model/index.js";
import { isRow, own } from "../shared/index.js";
import type {
	AnyGuardConfig,
	GuardConfig,
	GuardOptions,
	WithPermission,
} from "./guard.types.js";

/**
 * Configures the guard once: how to find the actor, and which policy to build for them.
 * When the declarations name an `env`, also how to read the environment of one call.
 *
 * Returns `withPermission(options, handler)`, which resolves the actor, builds the policy,
 * loads and checks the row, validates the payload, and only then runs your handler.
 * Arguments pass through untouched, so server actions, `useActionState` and route handlers
 * all work with the same wrapper.
 *
 * @example
 * export const withPermission = createGuard({ ac, getActor, policy: policyFor });
 */
export const createGuard = <AC extends ResourceMap, Actor>(
	config: GuardConfig<AC, Actor>,
): WithPermission<AC, Actor> => {
	const setup: AnyGuardConfig<Actor> = config;

	const onDeny = own(setup, "onDeny");
	const onUnauthenticated = own(setup, "onUnauthenticated");

	const watch = own(setup, "onDecision");
	const getEnv = own(setup, "getEnv");

	const readEnv =
		getEnv === undefined
			? undefined
			: async (args: unknown[]): Promise<unknown> => getEnv(...args);

	const deny = (error: ForbiddenError): never => {
		onDeny?.(error);
		throw error;
	};

	const authorizeMutation = (
		ability: Ability,
		action: string,
		resource: string,
		row: Row | undefined,
		payload: Row,
	): Row => {
		if (!ability.canMutate(action, resource, row)) {
			deny(new ForbiddenError(action, resource));
		}

		const result = ability.validatePayload(action, resource, row, payload);

		if (result.ok) {
			return result.data;
		}

		return deny(new ForbiddenError(action, resource, result.violations));
	};

	const authorize = (
		ability: Ability,
		action: string,
		resource: string,
		row: Row | undefined,
		payload: Row | undefined,
	): Row | undefined => {
		if (payload !== undefined) {
			return authorizeMutation(ability, action, resource, row, payload);
		}

		try {
			ability.authorize(action, resource, row);
		} catch (error) {
			if (ForbiddenError.is(error)) {
				deny(error);
			}

			throw error;
		}

		return undefined;
	};

	const withPermission = (
		options: GuardOptions,
		handler: (ctx: unknown, ...args: unknown[]) => unknown,
	) => {
		const load = own(options, "load");
		const payloadOf = own(options, "payload");

		const guarded = async (...args: unknown[]): Promise<unknown> => {
			let actor: Actor | null | undefined;
			let env: unknown;

			if (readEnv === undefined) {
				actor = await setup.getActor();
			} else {
				[actor, env] = await Promise.all([setup.getActor(), readEnv(args)]);
			}

			if (actor === null || actor === undefined) {
				onUnauthenticated?.({
					action: options.action,
					resource: options.resource,
				});

				return deny(new ForbiddenError(options.action, options.resource));
			}

			const report =
				watch === undefined
					? undefined
					: (decision: Decision) => watch(decision, actor, env);

			const built = build(
				setup.ac,
				setup.policy(actor),
				report === undefined ? {} : { onDecision: report },
			);

			const typedAbility = readEnv === undefined ? built : bindEnv(built, env);

			let row: Row | undefined;

			if (load !== undefined) {
				const loaded = await load(...args);

				if (!isRow(loaded)) {
					report?.({
						action: options.action,
						resource: options.resource,
						allowed: false,
						reason: "no row",
					});

					return deny(new ForbiddenError(options.action, options.resource));
				}

				row = loaded;
			}

			const payload = payloadOf === undefined ? undefined : payloadOf(...args);

			const validatedPayload = authorize(
				typedAbility,
				options.action,
				options.resource,
				row,
				payload,
			);

			const ctx = {
				actor,
				ability: typedAbility,
				row,
				payload: validatedPayload,
			};

			return handler(ctx, ...args);
		};

		return guarded;
	};

	return withPermission as WithPermission<AC, Actor>;
};
