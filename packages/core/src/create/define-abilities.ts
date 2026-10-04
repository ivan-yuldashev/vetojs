import type { ResourceDefinition } from "./define-abilities.types.js";

/**
 * Declares your domain: what resources exist, what can be done to them, how they relate.
 *
 * This is the root of type inference — resource names, per-resource actions and row shapes
 * are all read back out of this one declaration, so a typo in a rule is a compile error.
 * At runtime it returns `config.resources` unchanged.
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
>(config: {
	resources: T;
}): T => {
	return config.resources;
};
