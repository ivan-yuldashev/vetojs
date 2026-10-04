import { assert, describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { parseRules } from "../../src/validate/index.js";

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

describe("a compiled condition and the shorthand it resembles", () => {
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
			const result = parseRules(overWire);

			assert(result.ok);

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

describe("a resource whose own columns are named after the condition AST", () => {
	const acRules = defineAbilities({
		resources: {
			rule: {
				schema: shape<{ field: string; op: string; value: string }>(),
				actions: ["read"],
			},
		},
	});

	const forRules = createRules(acRules);

	it("takes a shorthand naming field, op and value at once", () => {
		const rule = forRules.allow("read", "rule", {
			where: { field: "authorId", op: "eq", value: "u1" },
		});

		expect(rule.where).toEqual({
			and: [
				{ field: "field", op: "eq", value: "authorId" },
				{ field: "op", op: "eq", value: "eq" },
				{ field: "value", op: "eq", value: "u1" },
			],
		});
	});

	it("takes a shorthand shaped like a relation node", () => {
		const acLinks = defineAbilities({
			resources: {
				link: {
					schema: shape<{ relation: string; type: string; where: string }>(),
					actions: ["read"],
				},
			},
		});

		const rule = createRules(acLinks).allow("read", "link", {
			where: { relation: "author", type: "one", where: { ne: "x" } },
		});

		expect(rule.where).toEqual({
			and: [
				{ field: "relation", op: "eq", value: "author" },
				{ field: "type", op: "eq", value: "one" },
				{ field: "where", op: "ne", value: "x" },
			],
		});
	});

	it("answers about a row of that table", () => {
		const ability = buildAbility(acRules, [
			forRules.allow("read", "rule", { where: { op: "eq" } }),
		]);

		expect(
			ability.can("read", "rule", { field: "authorId", op: "eq", value: "u1" }),
		).toBe(true);
		expect(
			ability.can("read", "rule", { field: "authorId", op: "gt", value: "u1" }),
		).toBe(false);
	});
});
