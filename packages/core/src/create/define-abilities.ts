import type { Declared, ResourceDefinition } from "./define-abilities.types.js";
import type { AnySchema } from "./schema.types.js";

/**
 * Declares your domain: what resources exist, what can be done to them, how they relate.
 *
 * This is the root of type inference — resource names, per-resource actions and row shapes
 * are all read back out of this one declaration, so a typo in a rule is a compile error.
 * At runtime it returns `config.resources` unchanged.
 *
 * `env` declares what a rule's `when` may read — the hour, the request's IP, whether the
 * session passed MFA. It lives in the types alone: the ability then answers nothing until
 * {@link withEnv} binds an environment.
 *
 * @example
 * const ac = defineAbilities({
 *   resources: {
 *     post: {
 *       schema: shape<Post>(),
 *       actions: ["read", "update"],
 *       relations: { author: { resource: "user", kind: "one" } },
 *     },
 *     user: { schema: shape<User>(), actions: ["read"] },
 *   },
 * });
 */
export const defineAbilities = <
	const T extends Record<string, ResourceDefinition<keyof T & string>>,
	S extends AnySchema = never,
>(config: {
	env?: S;
	resources: T;
}): Declared<T, S> => {
	return config.resources as Declared<T, S>;
};
