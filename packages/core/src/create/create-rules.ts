import type { CheckedRule, Row, Rule } from "../model/index.js";
import { RuleEffect } from "../model/index.js";
import { only, own } from "../shared/index.js";
import { compileValues } from "./condition-shorthand.js";
import type { RuleFactory } from "./create-rules.types.js";
import type { ResourceMap } from "./define-abilities.types.js";
import {
	compileWhenInput,
	compileWhereInput,
	type Shorthand,
} from "./where-input.js";

type Fields = NonNullable<Rule["fields"]>;

type TargetInput = string | Readonly<Record<string, Fields | undefined>>;

type Options = { where?: Shorthand; values?: Row; when?: Shorthand };

const EMPTY_OPTIONS: Options = {};

type Target = { resource: string; fields: Fields | undefined };

type CreateRules<AC extends ResourceMap> = {
	allow: RuleFactory<AC, "allow">;
	deny: RuleFactory<AC, "deny">;
};

const targetOf = (target: TargetInput): Target => {
	if (typeof target === "string") {
		return { resource: target, fields: undefined };
	}

	const entry = only(Object.entries(target));

	if (entry === undefined) {
		throw new TypeError(
			"veto: a rule names one resource — write the resource, or an object naming it and the fields it covers.",
		);
	}

	return { resource: entry[0], fields: entry[1] };
};

const makeRule = (
	ac: ResourceMap,
	effect: RuleEffect,
	action: Rule["action"],
	target: TargetInput,
	options: Options = EMPTY_OPTIONS,
): Rule => {
	const { resource, fields } = targetOf(target);

	const rule: Rule = { effect, action, resource };

	const where = own(options, "where");
	const values = own(options, "values");
	const when = own(options, "when");

	if (where !== undefined) {
		rule.where = compileWhereInput(where, ac, resource);
	}

	if (fields !== undefined) {
		rule.fields = fields;
	}

	if (values !== undefined) {
		rule.values = compileValues(values);
	}

	if (when !== undefined) {
		rule.when = compileWhenInput(when);
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
 *
 * @example
 * const { allow, deny } = createRules(ac);
 *
 * const policyFor = (user: User) => [
 *   allow("read", "post", { where: { status: "published" } }),
 *   allow("update", "post", { where: { authorId: user.id } }),
 * ];
 */
export const createRules = <AC extends ResourceMap>(
	ac: AC,
): CreateRules<AC> => {
	const factory = (effect: RuleEffect) => {
		return (
			action: Rule["action"],
			target: TargetInput,
			options?: Options,
		): CheckedRule => {
			return makeRule(ac, effect, action, target, options) as CheckedRule;
		};
	};

	return {
		allow: factory(RuleEffect.Allow),
		deny: factory(RuleEffect.Deny),
	};
};
