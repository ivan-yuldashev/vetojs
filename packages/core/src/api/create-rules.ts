import type { Rule } from "../model/index.js";
import { RuleEffect, saysNothing } from "../shared/index.js";
import type { CheckedRule } from "./checked-rules.types.js";
import { compilePayloadConstraints } from "./condition-shorthand.js";
import type { RuleFactory } from "./create-rules.types.js";
import type { ResourceMap } from "./define-abilities.js";
import { compileWhereInput } from "./where-input.js";

const makeRule = (
	ac: ResourceMap,
	effect: RuleEffect,
	action: string | string[],
	resource: string,
	where: unknown,
	payload?: { fields?: PropertyKey[]; constraints?: unknown },
): Rule => {
	const rule: Rule = { effect, action, resource };

	if (where !== undefined) {
		const compiled = compileWhereInput(where, ac, resource);

		if (!saysNothing(compiled)) {
			rule.where = compiled;
		}
	}

	if (payload) {
		const compiled: NonNullable<Rule["payload"]> = {};

		if (payload.fields) {
			compiled.fields = payload.fields.filter(
				(field): field is string => typeof field === "string",
			);
		}

		if (payload.constraints !== undefined) {
			const constraints = compilePayloadConstraints(payload.constraints);

			if (!saysNothing(constraints)) {
				compiled.constraints = constraints;
			}
		}

		rule.payload = compiled;
	}

	return rule;
};

/**
 * Typed `allow` and `deny` factories bound to your declarations.
 *
 * Action, resource, `where` fields and payload keys are all checked against `ac`. The
 * shorthand is compiled immediately, so a rule is plain serializable JSON — actor values
 * are baked in as data, not closures.
 *
 * @param ac - your {@link defineAbilities} declarations
 * @param _options - `maxDepth` raises how deep relations may nest in `where` (default 3);
 *   the limit keeps type inference fast
 *
 * @example
 * const { allow, deny } = createRules(ac);
 *
 * const policyFor = (user: User) => [
 *   allow("read", "post", { where: { status: "published" } }),
 *   allow("update", "post", { where: { authorId: user.id } }),
 * ];
 */
export const createRules = <AC extends ResourceMap, D extends number = 3>(
	ac: AC,
	_options?: { maxDepth?: D },
): {
	allow: RuleFactory<AC, D>;
	deny: RuleFactory<AC, D>;
} => {
	const factory = (effect: RuleEffect): RuleFactory<AC, D> => {
		const create: RuleFactory<AC, D> = (action, resource, options) => {
			return makeRule(
				ac,
				effect,
				action,
				resource,
				options?.where,
				options?.payload,
			) as CheckedRule;
		};

		return create;
	};

	return {
		allow: factory(RuleEffect.Allow),
		deny: factory(RuleEffect.Deny),
	};
};
