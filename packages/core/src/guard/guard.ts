import type { AbilitySet, ResourceMap } from "../api/index.js";
import { buildAbility } from "../api/index.js";
import { ForbiddenError } from "../errors/index.js";
import { ruleMatches } from "../evaluation/index.js";
import type { Rule } from "../model/index.js";
import {
	isPayloadScoped,
	isPlainObject,
	type Row,
	RuleEffect,
} from "../shared/index.js";
import type {
	GuardConfig,
	GuardOptions,
	WithPermission,
} from "./guard.types.js";

const hasMatchingDeny = (
	rules: readonly Rule[],
	action: string,
	resource: string,
): boolean => {
	return rules.some(
		(rule) =>
			rule.effect === RuleEffect.Deny &&
			ruleMatches(rule, action, resource) &&
			!isPayloadScoped(rule),
	);
};

const mutationRowAllowed = (
	ability: AbilitySet,
	action: string,
	resource: string,
	row: Row | undefined,
	base: Row,
): boolean => {
	if (row === undefined) {
		return !hasMatchingDeny(ability.rules, action, resource);
	}

	return ability.canMutate(action, resource, base);
};

/**
 * Configures the guard once: how to find the actor, and which policy to build for them.
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
	const deny = (error: ForbiddenError): never => {
		config.onDeny?.(error);
		throw error;
	};

	const authorizeMutation = (
		ability: AbilitySet,
		action: string,
		resource: string,
		row: Row | undefined,
		payload: Row,
	): Row => {
		const base = row ?? {};

		if (!mutationRowAllowed(ability, action, resource, row, base)) {
			deny(new ForbiddenError(action, resource));
		}

		const result = ability.validatePayload(action, resource, base, payload);

		if (result.ok) {
			return result.data;
		}

		return deny(new ForbiddenError(action, resource, result.violations));
	};

	const authorize = (
		ability: AbilitySet,
		action: string,
		resource: string,
		row: Row | undefined,
		payload: Row | undefined,
	): Row | undefined => {
		if (payload !== undefined) {
			return authorizeMutation(ability, action, resource, row, payload);
		}

		if (row !== undefined && !ability.can(action, resource, row)) {
			deny(new ForbiddenError(action, resource));
		}

		if (row === undefined && ability.cannot(action, resource)) {
			deny(new ForbiddenError(action, resource));
		}

		return undefined;
	};

	const withPermission = (
		options: GuardOptions,
		handler: (ctx: unknown, ...args: unknown[]) => unknown,
	) => {
		const guarded = async (...args: unknown[]): Promise<unknown> => {
			const { action, resource } = options;

			const actor = await config.getActor();

			if (actor === null || actor === undefined) {
				config.onUnauthenticated?.({ action, resource });

				return deny(new ForbiddenError(action, resource));
			}

			const watch = config.onDecision;
			const typedAbility = buildAbility(
				config.ac,
				config.policy(actor),
				watch === undefined
					? {}
					: { onDecision: (decision) => watch(decision, actor) },
			);

			let row: Row | undefined;

			if (options.load) {
				const loaded = await options.load(...args);

				if (!isPlainObject<Row>(loaded)) {
					watch?.(
						{ action, resource, allowed: false, reason: "no row" },
						actor,
					);

					return deny(new ForbiddenError(action, resource));
				}

				row = loaded;
			}

			const payload = options.payload ? options.payload(...args) : undefined;

			const validatedPayload = authorize(
				typedAbility,
				action,
				resource,
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
