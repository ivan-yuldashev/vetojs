import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";

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

export const twoAtOnce = () => {
	// @ts-expect-error a field takes one operator
	allow("read", "user", { where: { age: { gte: 18, lte: 65 } } });
	// @ts-expect-error the same on a deny
	deny("read", "user", { where: { age: { gt: 1, lt: 5 } } });
	// @ts-expect-error three are no better than two
	allow("read", "user", { where: { age: { gt: 1, lt: 5, ne: 3 } } });

	// @ts-expect-error inside a group
	allow("read", "user", { where: { and: [{ age: { gte: 1, lte: 5 } }] } });
	// @ts-expect-error inside the other group
	allow("read", "user", { where: { or: [{ age: { gte: 1, lte: 5 } }] } });
	// @ts-expect-error under a negation
	allow("read", "user", { where: { not: { age: { gte: 1, lte: 5 } } } });
	allow("read", "user", {
		// @ts-expect-error inside a relation
		where: { posts: { some: { views: { gte: 1, lte: 5 } } } },
	});

	allow("update", "user", {
		// @ts-expect-error and in a value condition
		values: { age: { gte: 18, lte: 65 } },
	});
};

describe("a field takes one operator at a time", () => {
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
