import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";

type User = { id: string; age: number; role: string; profile: unknown };

const ac = defineAbilities({
	resources: {
		user: {
			schema: shape<User>(),
			actions: ["read", "update"],
			relations: { posts: { resource: "post", kind: "many" } },
		},
		post: { schema: shape<{ id: string; views: number }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const row: User = { id: "u1", age: 30, role: "editor", profile: null };

describe("a field takes one operator at a time", () => {
	describe("two of them are refused, not quietly compiled", () => {
		it("names both and shows the and that means it", () => {
			expect(() =>
				allow("read", "user", {
					where: { age: { gte: 18, lte: 65 } as never },
				}),
			).toThrow(/"gte" and "lte"/);

			expect(() =>
				allow("read", "user", {
					where: { age: { gte: 18, lte: 65 } as never },
				}),
			).toThrow(
				/and: \[\{ field: \{ gte: … \} \}, \{ field: \{ lte: … \} \}\]/,
			);
		});

		it("refuses them on a deny as readily as on an allow", () => {
			expect(() =>
				deny("read", "user", { where: { age: { gt: 1, lt: 5 } as never } }),
			).toThrow(TypeError);
		});

		it("refuses them under and, or, not and inside a relation", () => {
			const two = { views: { gte: 1, lte: 5 } } as never;

			expect(() => allow("read", "user", { where: { and: [two] } })).toThrow(
				TypeError,
			);
			expect(() => allow("read", "user", { where: { or: [two] } })).toThrow(
				TypeError,
			);
			expect(() => allow("read", "user", { where: { not: two } })).toThrow(
				TypeError,
			);
			expect(() =>
				allow("read", "user", { where: { posts: { some: two } } }),
			).toThrow(TypeError);
		});

		it("refuses them in a payload constraint", () => {
			expect(() =>
				allow("update", "user", {
					payload: { constraints: { age: { gte: 18, lte: 65 } as never } },
				}),
			).toThrow(TypeError);
		});

		it("refuses three as readily as two", () => {
			expect(() =>
				allow("read", "user", {
					where: { age: { gt: 1, lt: 5, ne: 3 } as never },
				}),
			).toThrow(TypeError);
		});
	});

	describe("what the and it suggests actually does", () => {
		const ability = buildAbility(ac, [
			allow("read", "user", {
				where: { and: [{ age: { gte: 18 } }, { age: { lte: 65 } }] },
			}),
		]);

		it("grants inside the range", () => {
			expect(ability.can("read", "user", row)).toBe(true);
		});

		it("refuses outside it, at both ends", () => {
			expect(ability.can("read", "user", { ...row, age: 17 })).toBe(false);
			expect(ability.can("read", "user", { ...row, age: 70 })).toBe(false);
		});
	});

	describe("what still compiles as it did", () => {
		it("takes a single operator", () => {
			expect(
				allow("read", "user", { where: { age: { gte: 18 } } }).where,
			).toEqual({ field: "age", op: "gte", value: 18 });
		});

		it("takes a plain value, object or not", () => {
			expect(
				allow("read", "user", { where: { role: "editor" } }).where,
			).toEqual({ field: "role", op: "eq", value: "editor" });

			expect(
				allow("read", "user", {
					where: { profile: { theme: "dark" } } as never,
				}).where,
			).toEqual({ field: "profile", op: "eq", value: { theme: "dark" } });
		});

		it("leaves a value object alone when only some keys read as operators", () => {
			expect(
				allow("read", "user", {
					where: { profile: { gte: 1, theme: "dark" } } as never,
				}).where,
			).toEqual({
				field: "profile",
				op: "eq",
				value: { gte: 1, theme: "dark" },
			});
		});

		it("keeps an empty operator object fail-closed rather than refused", () => {
			const ability = buildAbility(ac, [
				allow("read", "user", { where: { age: {} as never } }),
			]);

			expect(ability.can("read", "user", row)).toBe(false);
		});

		it("takes several fields side by side", () => {
			expect(
				allow("read", "user", { where: { age: { gte: 18 }, role: "editor" } })
					.where,
			).toEqual({
				and: [
					{ field: "age", op: "gte", value: 18 },
					{ field: "role", op: "eq", value: "editor" },
				],
			});
		});

		it("takes a relation quantifier, which is not an operator object", () => {
			expect(
				allow("read", "user", { where: { posts: { some: { views: 5 } } } })
					.where,
			).toEqual({
				relation: "posts",
				type: "many",
				match: "some",
				where: { field: "views", op: "eq", value: 5 },
			});
		});
	});
});
