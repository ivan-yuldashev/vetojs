import { assert, describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { CheckedRules } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Post = { id: string; authorId: string };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string }>(), actions: ["read"] },
	},
});

const { allow } = createRules(ac);

const INHERITED = [
	"constructor",
	"toString",
	"valueOf",
	"hasOwnProperty",
	"__proto__",
	"__defineGetter__",
	"isPrototypeOf",
] as const;

const post: Post = { id: "p1", authorId: "u1" };

const asRule = (resource: string): CheckedRules =>
	[{ effect: "allow", action: "read", resource }] as CheckedRules;

describe("a name that every object inherits is not a declaration", () => {
	describe("the gate reads such a name as a name, nothing more", () => {
		it("accepts a rule naming an inherited member as its resource", () => {
			for (const resource of INHERITED) {
				const result = parseRules(asRule(resource));

				expect(result.ok).toBe(true);
				expect(result.ok && result.rules).toHaveLength(1);
			}
		});

		it("accepts a rule reaching for a relation of that name", () => {
			for (const relation of INHERITED) {
				const result = parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: {
							relation,
							type: "one",
							where: { field: "id", op: "eq", value: "u1" },
						},
					},
				]);

				expect(result.ok).toBe(true);
			}
		});

		it("still accepts the resources that were declared", () => {
			const result = parseRules(asRule("post"));

			expect(result.ok && result.rules).toHaveLength(1);
		});
	});

	describe("validate refuses what was never declared", () => {
		it("says the resource is unknown for every inherited name", () => {
			const ability = buildAbility(ac, []);

			for (const resource of INHERITED) {
				const answer = ability.validate(resource as "post", { anything: true });

				assert(!answer.ok);

				expect(answer.issues[0]?.message).toContain(resource);
			}
		});

		it("still validates a declared resource", () => {
			expect(buildAbility(ac, []).validate("post", post).ok).toBe(true);
		});
	});

	describe("a check about such a resource answers no", () => {
		it("grants nothing and prohibits nothing", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			for (const resource of INHERITED) {
				expect(ability.can("read", resource as "post", post)).toBe(false);
				expect(ability.can("read", resource as "post")).toBe(false);
				expect(
					ability.permittedFields("read", resource as "post", undefined, [
						"id",
					]),
				).toEqual([]);
			}
		});
	});

	describe("a rule written against such a name is a plain field, not a relation", () => {
		it("compiles the shorthand as a field condition", () => {
			for (const name of INHERITED) {
				const rule = allow("read", "post", {
					where: { [name]: { id: "u1" } } as never,
				});

				expect(rule.where).toEqual({
					field: name,
					op: "eq",
					value: { id: "u1" },
				});
			}
		});

		it("answers no for a row that does not carry it as its own", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { toString: "x" } as never }),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
			expect(
				ability.can("read", "post", { ...post, toString: "x" } as Post),
			).toBe(true);
		});
	});

	describe("a resource genuinely called that still works", () => {
		const hostile = defineAbilities({
			resources: {
				constructor: {
					schema: shape<Post>(),
					actions: ["read"],
					relations: { toString: { resource: "valueOf", kind: "one" } },
				},
				valueOf: { schema: shape<{ id: string }>(), actions: ["read"] },
			},
		});

		const rules = createRules(hostile);

		it("parses, checks and validates like any other name", () => {
			const result = parseRules([
				{ effect: "allow", action: "read", resource: "constructor" },
			]);

			expect(result.ok && result.rules).toHaveLength(1);

			const ability = buildAbility(hostile, [
				rules.allow("read", "constructor"),
			]);

			expect(ability.can("read", "constructor", post)).toBe(true);
			expect(ability.validate("constructor", post).ok).toBe(true);
		});

		it("keeps a relation of that name a relation", () => {
			const rule = rules.allow("read", "constructor", {
				where: { toString: { id: "u1" } },
			});

			expect(rule.where).toEqual({
				relation: "toString",
				type: "one",
				where: { field: "id", op: "eq", value: "u1" },
			});
		});

		it("leaves the prototype alone through all of it", () => {
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
			expect(Object.prototype).not.toHaveProperty("read");
		});
	});
});
