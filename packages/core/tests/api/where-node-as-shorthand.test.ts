import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";

type Author = { id: string; role: string };
type Post = { id: string; authorId: string; views: number; author?: Author };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: {
				author: { resource: "author", kind: "one" },
				editors: { resource: "author", kind: "many" },
			},
		},
		author: { schema: shape<Author>(), actions: ["read"] },
	},
});

const { allow } = createRules(ac);

const post: Post = { id: "p1", authorId: "u1", views: 10 };

const asShorthand = (value: unknown) => value as { authorId: string };

describe("a condition that was already compiled is refused, not re-read", () => {
	describe("the mistake is reported where it is made", () => {
		it("refuses a leaf node", () => {
			const compiled = allow("read", "post", { where: { authorId: "u1" } });

			expect(() =>
				allow("update", "post", { where: asShorthand(compiled.where) }),
			).toThrow(TypeError);
		});

		it("says what to pass instead", () => {
			expect(() =>
				allow("read", "post", {
					where: asShorthand({ field: "authorId", op: "eq", value: "u1" }),
				}),
			).toThrow(/parseRules/);
		});

		it("refuses a relation node, to-one and to-many alike", () => {
			for (const node of [
				{
					relation: "author",
					type: "one",
					where: { field: "role", op: "eq", value: "admin" },
				},
				{
					relation: "editors",
					type: "many",
					match: "some",
					where: { field: "role", op: "eq", value: "admin" },
				},
			]) {
				expect(() =>
					allow("read", "post", { where: asShorthand(node) }),
				).toThrow(TypeError);
			}
		});

		it("refuses one nested inside and, or and not", () => {
			const leaf = { field: "authorId", op: "eq", value: "u1" };

			for (const where of [{ and: [leaf] }, { or: [leaf] }, { not: leaf }]) {
				expect(() =>
					allow("read", "post", { where: asShorthand(where) }),
				).toThrow(TypeError);
			}
		});

		it("refuses one handed to a relation as its inner condition", () => {
			expect(() =>
				allow("read", "post", {
					where: asShorthand({
						author: { field: "role", op: "eq", value: "admin" },
					}),
				}),
			).toThrow(TypeError);
		});
	});

	describe("the shorthand it could be confused with still compiles", () => {
		it("keeps a plain field condition", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("read", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
		});

		it("keeps an operator object, which also has one key", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { views: { gt: 5 } } }),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("read", "post", { ...post, views: 1 })).toBe(false);
		});

		it("keeps and, or and not over shorthand", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", {
					where: {
						or: [{ authorId: "u1" }, { and: [{ views: { gte: 100 } }] }],
					},
				}),
				allow("update", "post", { where: { not: { authorId: "u2" } } }),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(
				ability.can("read", "post", { ...post, authorId: "u2", views: 200 }),
			).toBe(true);
			expect(
				ability.can("read", "post", { ...post, authorId: "u2", views: 1 }),
			).toBe(false);
			expect(ability.can("update", "post", post)).toBe(true);
		});

		it("keeps relation shorthand", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { author: { role: "admin" } } }),
			]);

			expect(
				ability.can("read", "post", {
					...post,
					author: { id: "u1", role: "admin" },
				}),
			).toBe(true);
			expect(
				ability.can("read", "post", {
					...post,
					author: { id: "u1", role: "guest" },
				}),
			).toBe(false);
		});

		it("keeps a three-key shorthand whose operator is not one", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", {
					where: asShorthand({ field: "x", op: "sideways", value: 1 }),
				}),
			]);

			expect(
				ability.can("read", "post", {
					...post,
					...{ field: "x", op: "sideways", value: 1 },
				}),
			).toBe(true);
		});

		it("keeps a shorthand that carries more than the three keys", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", {
					where: asShorthand({
						field: "x",
						op: "eq",
						value: 1,
						authorId: "u1",
					}),
				}),
			]);

			expect(
				ability.can("read", "post", {
					...post,
					...{ field: "x", op: "eq", value: 1 },
				}),
			).toBe(true);
			expect(ability.can("read", "post", post)).toBe(false);
		});
	});

	describe("the way a compiled condition is meant to travel", () => {
		it("goes back in through parseRules", () => {
			const written = allow("read", "post", { where: { authorId: "u1" } });
			const overWire = JSON.parse(JSON.stringify([written])) as unknown;
			const result = parseRules(overWire, ac);

			expect(result.ok).toBe(true);

			if (!result.ok) {
				return;
			}

			const ability = buildAbility(ac, result.rules);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("read", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
		});

		it("is reused by writing the shorthand once", () => {
			const mine = { authorId: "u1" } as const;
			const ability = buildAbility(ac, [
				allow("read", "post", { where: mine }),
				allow("update", "post", { where: mine }),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("update", "post", post)).toBe(true);
			expect(ability.can("update", "post", { ...post, authorId: "u2" })).toBe(
				false,
			);
		});
	});
});
