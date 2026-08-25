import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import { markLoaded } from "../../src/evaluation/loaded.js";

type Author = {
	id: string;
	role: "admin" | "banned" | "user";
	team?: { id: string };
};
type Post = { id: string; authorId: string; views: number; author?: Author };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update", "publish"],
			relations: { author: { resource: "author", kind: "one" } },
		},
		author: { schema: shape<Author>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = { id: "p1", authorId: "u1", views: 10 };
const withAuthor = (role: Author["role"]): Post => ({
	...post,
	author: { id: "u1", role },
});

describe("stopping at the first grant never changes an answer", () => {
	describe("a deny is found wherever it was written", () => {
		it("overrides an allow that comes before it", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				deny("read", "post", { where: { views: { lt: 100 } } }),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
		});

		it("overrides an allow that comes after it", () => {
			const ability = buildAbility(ac, [
				deny("read", "post", { where: { views: { lt: 100 } } }),
				allow("read", "post"),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
		});

		it("overrides from behind two grants", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				allow("read", "post", { where: { authorId: "u1" } }),
				deny("read", "post", { where: { authorId: "u1" } }),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
			expect(ability.can("read", "post", { ...post, authorId: "u2" })).toBe(
				true,
			);
		});

		it("counts a deny written for several actions", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				deny(["update", "read"], "post", { where: { views: { lt: 100 } } }),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
			expect(ability.can("read", "post", { ...post, views: 200 })).toBe(true);
		});

		it("counts a deny written as manage", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				deny("manage", "post", { where: { views: { lt: 100 } } }),
			]);

			expect(ability.can("read", "post", post)).toBe(false);
		});

		it("does not let a deny for another action or resource interfere", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				deny("update", "post"),
				deny("read", "author"),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("update", "post", post)).toBe(false);
		});

		it("keeps a payload-only deny out of the row decision", () => {
			const ability = buildAbility(ac, [
				allow("update", "post", { payload: { fields: ["views", "authorId"] } }),
				deny("update", "post", { payload: { fields: ["authorId"] } }),
			]);

			expect(ability.can("update", "post", post)).toBe(true);
			expect(
				ability.validatePayload("update", "post", post, { authorId: "u2" }),
			).toEqual({
				ok: false,
				violations: [{ field: "authorId", reason: "field not permitted" }],
			});
		});

		it("answers the same however often it is asked", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				deny("read", "post", { where: { views: { lt: 100 } } }),
			]);

			for (let attempt = 0; attempt < 3; attempt++) {
				expect(ability.can("read", "post", post)).toBe(false);
				expect(ability.can("read", "post", { ...post, views: 200 })).toBe(true);
			}
		});
	});

	describe("a missing include is reported whatever the rule order", () => {
		const reaching = { where: { author: { role: "admin" } } } as const;

		it("throws when the rule that reaches a relation sits last", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
				allow("read", "post", reaching),
			]);

			expect(() => ability.can("read", "post", post)).toThrow(
				RelationNotLoadedError,
			);
		});

		it("throws when it sits first", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", reaching),
				allow("read", "post", { where: { authorId: "u1" } }),
			]);

			expect(() => ability.can("read", "post", post)).toThrow(
				RelationNotLoadedError,
			);
		});

		it("throws from a deny after a grant already settled the row", () => {
			const ability = buildAbility(ac, [
				allow("read", "post"),
				deny("read", "post", { where: { author: { role: "banned" } } }),
			]);

			expect(() => ability.can("read", "post", post)).toThrow(
				RelationNotLoadedError,
			);
		});

		it("throws on canMutate as it does on can", () => {
			const ability = buildAbility(ac, [
				allow("update", "post", { where: { authorId: "u1" } }),
				allow("update", "post", reaching),
			]);

			expect(() => ability.canMutate("update", "post", post)).toThrow(
				RelationNotLoadedError,
			);
		});

		it("answers once the relation is there", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
				allow("read", "post", reaching),
			]);

			expect(ability.can("read", "post", withAuthor("admin"))).toBe(true);
			expect(ability.can("read", "post", withAuthor("user"))).toBe(true);
			expect(
				ability.can("read", "post", { ...withAuthor("user"), authorId: "u2" }),
			).toBe(false);
		});

		it("answers for a relation the caller marked loaded and empty", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
				allow("read", "post", reaching),
			]);

			expect(
				ability.can("read", "post", markLoaded(post, "author", null)),
			).toBe(true);
		});

		it("keeps throwing on the second ask, from the prepared bucket", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
				allow("read", "post", reaching),
			]);

			expect(() => ability.can("read", "post", post)).toThrow(
				RelationNotLoadedError,
			);
			expect(() => ability.can("read", "post", post)).toThrow(
				RelationNotLoadedError,
			);
		});

		it("throws even when a deny would have settled the row first", () => {
			const ability = buildAbility(ac, [
				deny("read", "post", { where: { views: { lt: 100 } } }),
				allow("read", "post", reaching),
			]);

			expect(() => ability.can("read", "post", post)).toThrow(
				RelationNotLoadedError,
			);
		});

		it("reports a relation reached through another relation", () => {
			const deep = defineAbilities({
				resources: {
					post: {
						schema: shape<Post>(),
						actions: ["read"],
						relations: { author: { resource: "author", kind: "one" } },
					},
					author: {
						schema: shape<Author & { team?: { id: string } }>(),
						actions: ["read"],
						relations: { team: { resource: "team", kind: "one" } },
					},
					team: { schema: shape<{ id: string }>(), actions: ["read"] },
				},
			});

			const rules = createRules(deep);
			const ability = buildAbility(deep, [
				rules.allow("read", "post", {
					where: { author: { team: { id: "t1" } } },
				}),
			]);

			expect(() =>
				ability.can("read", "post", {
					...post,
					author: { id: "u1", role: "user" },
				}),
			).toThrow(RelationNotLoadedError);

			expect(
				ability.can("read", "post", {
					...post,
					author: { id: "u1", role: "user", team: { id: "t1" } },
				}),
			).toBe(true);
		});

		it("keeps failing closed on a row that is not an object", () => {
			const ability = buildAbility(ac, [allow("read", "post", reaching)]);

			expect(ability.can("read", "post", null as unknown as Post)).toBe(false);
			expect(ability.can("read", "post", "row" as unknown as Post)).toBe(false);
		});

		it("says nothing about a relation the asked-about pair does not use", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
				allow("update", "post", reaching),
			]);

			expect(ability.can("read", "post", post)).toBe(true);
		});
	});

	describe("the decision report tells the same story", () => {
		it("names the granting rule when nothing can prohibit", () => {
			const granting = allow("read", "post", { where: { authorId: "u1" } });
			const seen: unknown[] = [];
			const ability = buildAbility(ac, [granting, allow("read", "post")], {
				onDecision: (decision) => seen.push(decision),
			});

			expect(ability.can("read", "post", post)).toBe(true);
			expect(seen).toEqual([
				{ action: "read", resource: "post", allowed: true, rule: granting },
			]);
		});

		it("names the deny that overrode a grant", () => {
			const prohibiting = deny("read", "post", {
				where: { views: { lt: 100 } },
			});
			const seen: unknown[] = [];
			const ability = buildAbility(ac, [allow("read", "post"), prohibiting], {
				onDecision: (decision) => seen.push(decision),
			});

			expect(ability.can("read", "post", post)).toBe(false);
			expect(seen).toEqual([
				{ action: "read", resource: "post", allowed: false, rule: prohibiting },
			]);
		});

		it("names no rule when nothing matched", () => {
			const seen: unknown[] = [];
			const ability = buildAbility(ac, [allow("read", "post")], {
				onDecision: (decision) => seen.push(decision),
			});

			expect(ability.can("publish", "post", post)).toBe(false);
			expect(seen).toEqual([
				{ action: "publish", resource: "post", allowed: false },
			]);
		});
	});
});
