import { createSelect, resolveWhen } from "../compile/index.js";
import type { EnvDeclared, EnvOf, ResourceMap } from "../create/index.js";
import type { Env } from "../model/index.js";
import { isPlainObject, own, owns } from "../shared/index.js";
import type { Ability, AbilityForEnv } from "./ability.types.js";

const EMPTY_ENV: Env = {};

const isSameEnv = (a: Env, b: Env): boolean => {
	const keys = Object.keys(a);

	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => owns(b, key) && Object.is(own(a, key), own(b, key)))
	);
};

export const bindEnv = (
	ability: Pick<AbilityForEnv, "rules" | "~veto.withSelect" | "~veto.binding">,
	env: unknown,
): Ability => {
	const bound = isPlainObject<Env>(env) ? env : EMPTY_ENV;
	let binding = ability["~veto.binding"];

	if (binding === undefined) {
		binding = {
			select: createSelect(ability.rules, true),
			env: undefined,
			ability: undefined,
		};

		ability["~veto.binding"] = binding;
	}

	if (
		binding.env !== undefined &&
		binding.ability !== undefined &&
		isSameEnv(binding.env, bound)
	) {
		return binding.ability;
	}

	const next = ability["~veto.withSelect"](
		(action, resource) => resolveWhen(binding.select(action, resource), bound),
		binding,
	);

	binding.env = bound;
	binding.ability = next;

	return next;
};

/**
 * Binds the environment one request runs in — the hour, the IP, whether the session passed
 * MFA — and returns the ability to ask. Bind once per request and ask it as often as needed:
 * `can` and `where` on one binding read the same environment, so the query selects the rows
 * the check allows.
 *
 * An `allow` takes part only when its `when` holds. A `deny` stays unless its `when` fails,
 * and a key the environment lacks fails nothing, so a missing value never lifts a
 * prohibition. Without a binding, an `allow` with `when` grants nothing and a `deny` with
 * `when` always stands.
 *
 * Binding again to an environment with the same keys and values hands back the same
 * ability, so an environment written as a literal on every render does not rebind.
 *
 * Kept apart from the ability so that code which never reads an environment does not carry
 * the code that does.
 *
 * @example
 * const ability = withEnv(buildAbility(ac, policyFor(user)), { hour: 14, mfa: true });
 * ability.can("delete", "invoice", invoice);
 */
export const withEnv = <AC extends ResourceMap & EnvDeclared>(
	ability: AbilityForEnv<AC>,
	env: EnvOf<AC>,
): Ability<AC> => {
	return bindEnv(ability, env);
};
