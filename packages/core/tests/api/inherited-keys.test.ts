import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import { toVocabulary } from "../../src/api/vocabulary.js";

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
	describe("the trust gate answers instead of crashing", () => {
		it("quarantines a rule naming an inherited member as its resource", () => {
			for (const resource of INHERITED) {
				const result = parseRules(asRule(resource), toVocabulary(ac));

				expect(result.ok).toBe(true);

				if (!result.ok) {
					continue;
				}

				expect(result.unknown).toHaveLength(1);
				expect(result.rules).toHaveLength(0);
			}
		});

		it("quarantines a rule reaching for an inherited relation", () => {
			for (const relation of INHERITED) {
				const result = parseRules(
					[
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
					] as CheckedRules,
					toVocabulary(ac),
				);

				expect(result.ok).toBe(true);

				if (!result.ok) {
					continue;
				}

				expect(result.unknown).toHaveLength(1);
			}
		});

		it("keeps a deny it cannot place, exactly as for any unknown resource", () => {
			const inherited = parseRules(
				[
					{ effect: "deny", action: "read", resource: "toString" },
				] as CheckedRules,
				toVocabulary(ac),
			);

			const ghost = parseRules(
				[{ effect: "deny", action: "read", resource: "ghost" }] as CheckedRules,
				toVocabulary(ac),
			);

			expect(inherited.ok).toBe(true);
			expect(ghost.ok).toBe(true);

			if (!inherited.ok || !ghost.ok) {
				return;
			}

			expect(inherited.rules).toHaveLength(1);
			expect(inherited.unknown).toHaveLength(1);
			expect(inherited.rules.length).toBe(ghost.rules.length);
			expect(inherited.unknown.length).toBe(ghost.unknown.length);
		});

		it("still accepts the resources that were declared", () => {
			const result = parseRules(asRule("post"), toVocabulary(ac));

			expect(result.ok && result.rules).toHaveLength(1);
		});
	});

	describe("validate refuses what was never declared", () => {
		it("says the resource is unknown for every inherited name", () => {
			const ability = buildAbility(ac, []);

			for (const resource of INHERITED) {
				const answer = ability.validate(resource as "post", { anything: true });

				expect(answer.ok).toBe(false);

				if (answer.ok) {
					continue;
				}

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
					ability.permittedFields("read", resource as "post", ["id"]),
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
			const result = parseRules(
				[
					{ effect: "allow", action: "read", resource: "constructor" },
				] as CheckedRules,
				toVocabulary(hostile),
			);

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
