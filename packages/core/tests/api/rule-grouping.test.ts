import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";

type Post = { id: string; authorId: string; views: number };
type Comment = { id: string; spam: boolean };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update", "publish"] },
		comment: { schema: shape<Comment>(), actions: ["read", "delete"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = { id: "p1", authorId: "u1", views: 10 };
const comment: Comment = { id: "c1", spam: false };

describe("the same ability answering about many pairs", () => {
	it("keeps the answers apart by action", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("update", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(false);
		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(false);
	});

	it("keeps the answers apart by resource", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "comment", comment)).toBe(false);
		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "comment", comment)).toBe(false);
	});

	it("lets a manage rule answer for every action, however often it is asked", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("publish", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(true);
		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "comment", comment)).toBe(false);
	});

	it("serves each action of a rule written for several", () => {
		const ability = buildAbility(ac, [
			allow(["update", "publish"], "post", { where: { authorId: "u1" } }),
		]);

		expect(ability.can("update", "post", post)).toBe(true);
		expect(ability.can("publish", "post", post)).toBe(true);
		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("update", "post", { ...post, authorId: "u2" })).toBe(
			false,
		);
	});

	it("answers the same for every method that reads the rules", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", {
				where: { authorId: "u1" },
				payload: { fields: ["views"] },
			}),
		]);

		expect(ability.can("update", "post", post)).toBe(true);
		expect(ability.canMutate("update", "post", post)).toBe(true);
		expect(ability.permittedFields("update", "post", ["views", "id"])).toEqual([
			"views",
		]);
		expect(ability.where("update", "post")).toEqual({
			field: "authorId",
			op: "eq",
			value: "u1",
		});
		expect(
			ability.validatePayload("update", "post", post, { views: 11 }),
		).toEqual({ ok: true, data: { views: 11 } });
		expect(ability.can("update", "post", post)).toBe(true);
	});

	it("hands back the policy it was built with, untouched", () => {
		const rules = [allow("read", "post")];
		const ability = buildAbility(ac, rules);

		ability.can("read", "post", post);
		ability.can("delete", "comment", comment);

		expect(ability.rules).toEqual(rules);
		expect(ability.rules).toHaveLength(1);
	});
});

describe("a grant is final only when the pair carries no deny", () => {
	it("still lets a later deny override an earlier allow", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post", { where: { views: { lt: 100 } } }),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post", { ...post, views: 200 })).toBe(true);
	});

	it("gives the same answer after another row was asked in between", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post", { where: { views: { lt: 100 } } }),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		ability.can("read", "post", { ...post, views: 200 });

		expect(ability.can("read", "post", post)).toBe(false);
	});

	it("does not count a deny that only narrows the payload", () => {
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
		expect(
			ability.validatePayload("update", "post", post, { views: 11 }),
		).toEqual({ ok: true, data: { views: 11 } });
	});

	it("keeps the rule that granted in the decision report", () => {
		const seen: unknown[] = [];
		const granting = allow("read", "post");
		const ability = buildAbility(ac, [granting, allow("read", "post")], {
			onDecision: (decision) => seen.push(decision.rule),
		});

		expect(ability.can("read", "post", post)).toBe(true);
		expect(seen).toEqual([granting]);
	});
});

describe("the prepared matchers and the plain walk agree", () => {
	it("mixes rules with and without a condition", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			allow("read", "post", { where: { authorId: "u1" } }),
			deny("read", "post", { where: { views: { gt: 100 } } }),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "post", { ...post, views: 200 })).toBe(false);
		expect(ability.can("read", "post", { ...post, authorId: "u2" })).toBe(true);
	});

	it("answers the same on the second call, from the prepared bucket", () => {
		const ability = buildAbility(ac, [
			allow("read", "post", { where: { views: { gte: 10 } } }),
		]);

		const low = { ...post, views: 1 };

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "post", low)).toBe(false);
		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "post", low)).toBe(false);
	});

	it("keeps a relation loud through the prepared path", () => {
		const withRelation = defineAbilities({
			resources: {
				post: {
					schema: shape<Post>(),
					actions: ["read"],
					relations: { author: { resource: "user", kind: "one" } },
				},
				user: {
					schema: shape<{ id: string; role: string }>(),
					actions: ["read"],
				},
			},
		});

		const rules = createRules(withRelation);
		const ability = buildAbility(withRelation, [
			rules.allow("read", "post", { where: { author: { role: "admin" } } }),
		]);

		expect(() => ability.can("read", "post", post)).toThrow(
			RelationNotLoadedError,
		);
		expect(() => ability.can("read", "post", post)).toThrow(
			RelationNotLoadedError,
		);
	});
});
