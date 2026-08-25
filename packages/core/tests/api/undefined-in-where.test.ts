import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";

type User = { id: string; role: string };
type Post = {
	id: string;
	authorId: string | null;
	orgId: string;
	archived: boolean;
	author?: User;
	editors?: User[];
};

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: {
				author: { resource: "user", kind: "one" },
				editors: { resource: "user", kind: "many" },
			},
		},
		user: { schema: shape<User>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = {
	id: "p1",
	authorId: "u1",
	orgId: "o1",
	archived: false,
};

const stranger: Post = { ...post, id: "p2", authorId: "victim", orgId: "o2" };

const missing = undefined as unknown as string;

describe("a condition that would vanish is refused", () => {
	describe("the actor field that came back empty", () => {
		it("refuses the only condition of a rule", () => {
			expect(() =>
				allow("read", "post", { where: { authorId: missing } }),
			).toThrow(TypeError);
		});

		it("names the key that was empty", () => {
			expect(() =>
				allow("read", "post", { where: { authorId: missing } }),
			).toThrow(/where\.authorId/);
		});

		it("refuses one condition of several, which would widen the rule", () => {
			expect(() =>
				allow("read", "post", { where: { orgId: "o1", authorId: missing } }),
			).toThrow(TypeError);
		});

		it("refuses it inside an operator", () => {
			expect(() =>
				allow("read", "post", { where: { authorId: { eq: missing } } }),
			).toThrow(TypeError);
		});

		it("refuses it under and, or and not", () => {
			expect(() =>
				allow("read", "post", { where: { and: [{ authorId: missing }] } }),
			).toThrow(TypeError);
			expect(() =>
				allow("read", "post", { where: { or: [{ authorId: missing }] } }),
			).toThrow(TypeError);
			expect(() =>
				allow("read", "post", { where: { not: { authorId: missing } } }),
			).toThrow(TypeError);
		});

		it("refuses it inside a relation", () => {
			expect(() =>
				allow("read", "post", { where: { author: { role: missing } } }),
			).toThrow(TypeError);
		});

		it("refuses it as a quantifier", () => {
			expect(() =>
				allow("read", "post", {
					where: {
						editors: { some: undefined as unknown as { role: string } },
					},
				}),
			).toThrow(/where\.editors\.some/);
		});

		it("refuses it in a payload constraint", () => {
			expect(() =>
				allow("update", "post", {
					payload: { constraints: { orgId: missing } },
				}),
			).toThrow(/payload constraints\.orgId/);
		});

		it("refuses it on a deny, where it would forbid everything", () => {
			expect(() =>
				deny("update", "post", { where: { authorId: missing } }),
			).toThrow(TypeError);
		});
	});

	describe("a shorthand that describes nothing", () => {
		it("refuses a to-many relation with no quantifier", () => {
			expect(() =>
				allow("read", "post", {
					where: { editors: {} as { some: { role: string } } },
				}),
			).toThrow(/describes no condition/);
		});
	});

	describe("what still compiles, because it says something", () => {
		it("keeps an explicitly empty where as an unconditional rule", () => {
			const rule = allow("read", "post", { where: {} });

			expect(rule.where).toBeUndefined();
			expect(buildAbility(ac, [rule]).can("read", "post", stranger)).toBe(true);
		});

		it("keeps a rule written without a where at all", () => {
			expect(allow("read", "post").where).toBeUndefined();
		});

		it("keeps null, which is a value a row can hold", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: null } }),
			]);

			expect(ability.can("read", "post", { ...post, authorId: null })).toBe(
				true,
			);
			expect(ability.can("read", "post", post)).toBe(false);
		});

		it("keeps false, zero and the empty string", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { archived: false } }),
				allow("update", "post", { where: { orgId: "" } }),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("read", "post", { ...post, archived: true })).toBe(
				false,
			);
			expect(ability.can("update", "post", { ...post, orgId: "" })).toBe(true);
		});

		it("keeps exists, which asks about a field that is not there", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: { exists: false } } }),
			]);

			expect(ability.can("read", "post", { id: "p3" } as Post)).toBe(true);
			expect(ability.can("read", "post", post)).toBe(false);
		});

		it("keeps the vacuous and, which is true by definition", () => {
			const rule = allow("read", "post", { where: { and: [] } });

			expect(rule.where).toBeUndefined();
		});

		it("keeps the vacuous or, which grants nothing", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { or: [] } }),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
		});
	});

	describe("the same value arriving as a compiled rule", () => {
		it("is refused by the trust gate", () => {
			const result = parseRules(
				[
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: "authorId", op: "eq", value: undefined },
					},
				],
				ac,
			);

			expect(result.ok).toBe(false);

			if (result.ok) {
				return;
			}

			expect(result.errors.join(" ")).toMatch(/undefined is not a value/);
		});

		it("still accepts a rule comparing to null", () => {
			const result = parseRules(
				[
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: "authorId", op: "eq", value: null },
					},
				],
				ac,
			);

			expect(result.ok).toBe(true);
		});
	});

	describe("the leak the refusal closes", () => {
		it("never turns an owner rule into an unconditional grant", () => {
			const written = () =>
				allow("read", "post", { where: { authorId: missing } });

			expect(written).toThrow(TypeError);

			const sound = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
			]);

			expect(sound.can("read", "post", post)).toBe(true);
			expect(sound.can("read", "post", stranger)).toBe(false);
			expect(sound.where("read", "post")).toEqual({
				field: "authorId",
				op: "eq",
				value: "u1",
			});
		});
	});
});
