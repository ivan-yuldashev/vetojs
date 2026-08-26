import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";

type Post = { id: string; authorId: string; views: number };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
		comment: {
			schema: shape<{ id: string; spam: boolean }>(),
			actions: ["read"],
		},
	},
});

const { allow, deny } = createRules(ac);

const post: Post = { id: "p1", authorId: "u1", views: 10 };

describe("an ability answers from the policy it was built with", () => {
	describe("the array the caller keeps", () => {
		it("hands back a list of its own, equal to the one it was given", () => {
			const rules = [allow("read", "post")];
			const ability = buildAbility(ac, rules);

			expect(ability.rules).toEqual(rules);
			expect(ability.rules).not.toBe(rules);
			expect(ability.rules[0]).toBe(rules[0]);
		});

		it("refuses to have that list changed under it", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			expect(Object.isFrozen(ability.rules)).toBe(true);
			expect(() =>
				(ability.rules as CheckedRules).push(deny("read", "post")),
			).toThrow(TypeError);
			expect(ability.rules).toHaveLength(1);
		});

		it("ignores a deny appended after a pair was already asked about", () => {
			const rules = [allow("read", "post")];
			const ability = buildAbility(ac, rules);

			expect(ability.can("read", "post", post)).toBe(true);

			rules.push(deny("read", "post"));

			expect(ability.can("read", "post", post)).toBe(true);
			expect(buildAbility(ac, rules).can("read", "post", post)).toBe(false);
		});

		it("ignores an allow appended for a pair nobody has asked about yet", () => {
			const rules = [allow("read", "post")];
			const ability = buildAbility(ac, rules);

			expect(ability.can("read", "post", post)).toBe(true);

			rules.push(allow("update", "post"));

			expect(ability.can("update", "post", post)).toBe(false);
			expect(buildAbility(ac, rules).can("update", "post", post)).toBe(true);
		});

		it("ignores a policy emptied after the ability was built", () => {
			const rules = [allow("read", "post")];
			const ability = buildAbility(ac, rules);

			rules.length = 0;

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.rules).toHaveLength(1);
		});

		it("ignores a rule swapped in place for another", () => {
			const rules = [allow("read", "post", { where: { authorId: "u1" } })];
			const ability = buildAbility(ac, rules);

			expect(ability.can("read", "post", post)).toBe(true);

			rules[0] = deny("read", "post");

			expect(ability.can("read", "post", post)).toBe(true);
		});
	});

	describe("the rule objects themselves", () => {
		it("ignores a condition value swapped after the first check", () => {
			const rule = allow("read", "post", { where: { authorId: "u1" } });
			const ability = buildAbility(ac, [rule]);

			expect(ability.can("read", "post", post)).toBe(true);

			const where = rule.where as { value: unknown };
			where.value = "u2";

			expect(ability.can("read", "post", post)).toBe(true);
			expect(buildAbility(ac, [rule]).can("read", "post", post)).toBe(true);
		});

		it("reads a rule swapped before the first check, as it was never asked", () => {
			const rule = allow("read", "post", { where: { authorId: "u1" } });
			const ability = buildAbility(ac, [rule]);

			const where = rule.where as { value: unknown };
			where.value = "u2";

			expect(ability.can("read", "post", post)).toBe(false);
		});

		it("keeps two abilities built from one array apart", () => {
			const rules = [allow("read", "post", { where: { authorId: "u1" } })];
			const first = buildAbility(ac, rules);
			const second = buildAbility(ac, rules);

			expect(first.can("read", "post", post)).toBe(true);
			expect(second.can("read", "post", post)).toBe(true);
			expect(second.can("read", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
			expect(first.can("read", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
		});

		it("shares one condition object between two rules without mixing their verdicts", () => {
			const node = { field: "authorId", op: "eq", value: "u1" };
			const ability = buildAbility(ac, [
				{ effect: "allow", action: "read", resource: "post", where: node },
				{ effect: "allow", action: "update", resource: "post", where: node },
			] as unknown as CheckedRules);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("update", "post", post)).toBe(true);
			expect(ability.can("read", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
			expect(ability.can("update", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
		});
	});

	describe("names that could collide with an object's own", () => {
		const hostile = defineAbilities({
			resources: {
				__proto__: { schema: shape<Post>(), actions: ["read", "constructor"] },
				constructor: { schema: shape<Post>(), actions: ["read"] },
			},
		});

		const hostileRules = createRules(hostile);

		it("keeps a resource named like an object member in its own bucket", () => {
			const ability = buildAbility(hostile, [
				hostileRules.allow("read", "__proto__"),
			]);

			expect(ability.can("read", "__proto__", post)).toBe(true);
			expect(ability.can("read", "constructor", post)).toBe(false);
			expect(ability.can("read", "__proto__", post)).toBe(true);
			expect(ability.can("read", "constructor", post)).toBe(false);
		});

		it("keeps an action named like an object member in its own bucket", () => {
			const ability = buildAbility(hostile, [
				hostileRules.allow("constructor", "__proto__"),
			]);

			expect(ability.can("constructor", "__proto__", post)).toBe(true);
			expect(ability.can("read", "__proto__", post)).toBe(false);
			expect(ability.can("constructor", "__proto__", post)).toBe(true);
		});

		it("leaves the object prototype alone after all of it", () => {
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
			expect(Object.prototype).not.toHaveProperty("read");
		});
	});

	describe("rules that arrived broken", () => {
		it("answers no for a rule naming a resource that does not exist", () => {
			const ability = buildAbility(ac, [
				{ effect: "allow", action: "read", resource: "ghost" },
			] as CheckedRules);

			expect(ability.can("read", "post", post)).toBe(false);
			expect(ability.can("read", "ghost" as "post", post)).toBe(true);
		});

		it("survives a rule with no action at all", () => {
			const ability = buildAbility(ac, [
				{ effect: "allow", resource: "post" },
				allow("read", "post"),
			] as CheckedRules);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("update", "post", post)).toBe(false);
		});

		it("does not grant on a where that is not a condition", () => {
			const ability = buildAbility(ac, [
				{
					effect: "allow",
					action: "read",
					resource: "post",
					where: { nonsense: true },
				},
			] as unknown as CheckedRules);

			expect(ability.can("read", "post", post)).not.toBe(true);
		});
	});
});
