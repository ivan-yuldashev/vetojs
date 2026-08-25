import { ForbiddenError } from "../errors/index.js";
import {
	evaluateRules,
	matcherFor,
	mightAllow,
	type Prepared,
	prohibitsRow,
	type Reach,
	reachesOf,
	ruleMatches,
	type Settled,
	walkReaches,
} from "../evaluation/index.js";
import type { ConditionNode } from "../model/index.js";
import {
	isPlainObject,
	MANAGE_ACTION,
	own,
	type Row,
} from "../shared/index.js";
import type { AbilityOptions, AbilitySet } from "./ability.types.js";
import type { CheckedRules } from "./checked-rules.types.js";
import type { ResourceMap } from "./define-abilities.js";
import { canMutate, permittedFields, validatePayload } from "./mutation.js";
import type { PayloadResult } from "./mutation.types.js";
import { validateSchema } from "./schema.js";
import type { ValidateResult } from "./schema.types.js";
import { compileWhere } from "./where.js";

export type { AbilitySet } from "./ability.types.js";

type Narrowed = Prepared & { rules: CheckedRules; reaches: Reach[] };

const NOTHING: Narrowed = {
	rules: [],
	grantIsFinal: true,
	reaches: [],
	matchers: [],
};

/**
 * Turns a policy into the object you call.
 *
 * Accepts only rules that provably passed a check — from {@link createRules} (verified by
 * the compiler) or {@link parseRules} with a vocabulary (verified at runtime), so the
 * validation step for rules arriving from a database or the network cannot be skipped.
 *
 * The policy is read once, here. Changing the array or the rule objects afterwards does not
 * change the answers — build again for a policy that changed.
 *
 * @param registry - your {@link defineAbilities} declarations
 * @param rules - the policy for one actor
 *
 * @example
 * const ability = buildAbility(ac, policyFor(user));
 * ability.can("update", "post", post);
 */
export const buildAbility = <AC extends ResourceMap = ResourceMap>(
	registry: AC,
	rules: CheckedRules,
	options?: AbilityOptions,
): AbilitySet<AC> => {
	const report = options?.onDecision;

	const policy = [...rules];
	const buckets = new Map<string, Map<string, Narrowed>>();

	const declared = (action: string, resource: string): boolean => {
		if (action === MANAGE_ACTION) {
			return true;
		}

		return own(registry, resource)?.actions.includes(action) ?? false;
	};

	const relevant = (action: string, resource: string): Narrowed => {
		const byAction = buckets.get(resource);
		const known = byAction?.get(action);

		if (known !== undefined) {
			return known;
		}

		const only = policy.filter((rule) => ruleMatches(rule, action, resource));

		const narrowed: Narrowed =
			only.length === 0
				? NOTHING
				: {
						rules: only,
						grantIsFinal: !only.some(prohibitsRow),
						reaches: reachesOf(
							only.flatMap((rule) =>
								rule.where === undefined ? [] : [rule.where],
							),
						),
						matchers: only.map((rule) =>
							rule.where === undefined ? undefined : matcherFor(rule.where),
						),
					};

		if (!declared(action, resource)) {
			return narrowed;
		}

		if (byAction === undefined) {
			buckets.set(resource, new Map([[action, narrowed]]));
		} else {
			byAction.set(action, narrowed);
		}

		return narrowed;
	};

	const sound = (only: Narrowed, instance: unknown): void => {
		if (only.reaches.length > 0 && isPlainObject<Row>(instance)) {
			walkReaches(only.reaches, instance);
		}
	};

	const answer = (
		action: string,
		resource: string,
		allowed: boolean,
		settled: Settled<Row>,
	): boolean => {
		report?.(
			settled.rule === undefined
				? { action, resource, allowed }
				: { action, resource, allowed, rule: settled.rule },
		);

		return allowed;
	};

	const decide = (
		action: string,
		resource: string,
		instance?: unknown,
	): boolean => {
		const only = relevant(action, resource);

		sound(only, instance);

		if (report === undefined) {
			return instance === undefined
				? mightAllow(only.rules, action, resource)
				: evaluateRules(
						only.rules,
						action,
						resource,
						instance,
						undefined,
						only,
					);
		}

		const settled: Settled<Row> = {};

		return answer(
			action,
			resource,
			instance === undefined
				? mightAllow(only.rules, action, resource, settled)
				: evaluateRules(only.rules, action, resource, instance, settled, only),
			settled,
		);
	};

	const core = {
		rules,
		can: decide,
		cannot: (action: string, resource: string, instance?: unknown): boolean => {
			return !decide(action, resource, instance);
		},
		authorize: (action: string, resource: string, instance?: unknown): void => {
			if (!decide(action, resource, instance)) {
				throw new ForbiddenError(action, resource);
			}
		},
		canMutate: (action: string, resource: string, row: unknown): boolean => {
			const only = relevant(action, resource);

			sound(only, row);

			if (report === undefined) {
				return canMutate(only.rules, action, resource, row);
			}

			const settled: Settled<Row> = {};

			return answer(
				action,
				resource,
				canMutate(only.rules, action, resource, row, settled),
				settled,
			);
		},
		validatePayload: (
			action: string,
			resource: string,
			row: unknown,
			data: unknown,
		): PayloadResult<Row> => {
			const result = validatePayload(
				relevant(action, resource).rules,
				action,
				resource,
				row,
				data,
			);

			report?.(
				result.ok
					? { action, resource, allowed: true }
					: {
							action,
							resource,
							allowed: false,
							violations: result.violations,
						},
			);

			return result;
		},
		where: (action: string, resource: string): ConditionNode<Row> => {
			return compileWhere(relevant(action, resource).rules, action, resource);
		},
		permittedFields: (
			action: string,
			resource: string,
			fields: string[],
		): string[] => {
			return permittedFields(
				relevant(action, resource).rules,
				action,
				resource,
				fields,
			);
		},
		validate: (resource: string, data: unknown): ValidateResult<Row> => {
			const definition = own(registry, resource);

			return definition === undefined
				? {
						ok: false,
						issues: [{ message: `unknown resource "${resource}"` }],
					}
				: validateSchema(definition.schema, data);
		},
	};

	return core as AbilitySet<AC>;
};
