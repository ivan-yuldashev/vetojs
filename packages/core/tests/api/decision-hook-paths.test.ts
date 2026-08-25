import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { DecisionReport } from "../../src/api/ability.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import { markLoaded } from "../../src/evaluation/index.js";

type User = { id: string; role: "admin" | "editor" };
type Comment = { id: string; postId: string; spam: boolean };
type Post = {
	id: string;
	authorId: string;
	status: "draft" | "published";
	author?: User;
	comments?: Comment[];
};

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: {
				author: { resource: "user", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		user: { schema: shape<User>(), actions: ["read"] },
		comment: { schema: shape<Comment>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const admin: User = { id: "u1", role: "admin" };
const editor: User = { id: "u2", role: "editor" };

const postBy = (author: User, comments: Comment[] = []): Post =>
	markLoaded(
		markLoaded(
			{ id: "p1", authorId: author.id, status: "draft" } as Post,
			"author",
			author,
		),
		"comments",
		comments,
	);

const watch = (rules: Parameters<typeof buildAbility>[1]) => {
	const seen: DecisionReport[] = [];
	const ability = buildAbility(ac, rules, {
		onDecision: (decision) => seen.push(decision),
	});

	return { seen, ability };
};

describe("every answer reaches the hook", () => {
	describe("without a row", () => {
		it("reports the allow behind an optimistic yes", () => {
			const rule = allow("read", "post");
			const { seen, ability } = watch([rule]);

			expect(ability.can("read", "post")).toBe(true);
			expect(seen).toEqual([
				{ action: "read", resource: "post", allowed: true, rule },
			]);
		});

		it("reports the blanket deny behind a no", () => {
			const rule = deny("read", "post");
			const { seen, ability } = watch([allow("read", "post"), rule]);

			expect(ability.can("read", "post")).toBe(false);
			expect(seen[0]).toEqual({
				action: "read",
				resource: "post",
				allowed: false,
				rule,
			});
		});

		it("reports a no with no rule when the policy is silent", () => {
			const { seen, ability } = watch([allow("read", "user")]);

			expect(ability.can("read", "post")).toBe(false);
			expect(seen).toEqual([
				{ action: "read", resource: "post", allowed: false },
			]);
		});
	});

	describe("with a row", () => {
		it("reports no rule when the only allow did not match the row", () => {
			const { seen, ability } = watch([
				allow("read", "post", { where: { authorId: { eq: "someone" } } }),
			]);

			expect(ability.can("read", "post", postBy(admin))).toBe(false);
			expect(seen[0]).toEqual({
				action: "read",
				resource: "post",
				allowed: false,
			});
		});
	});

	describe("with a condition across a relation", () => {
		it("reports the allow that matched through a to-one relation", () => {
			const rule = allow("update", "post", {
				where: { author: { role: { eq: "admin" } } },
			});
			const { seen, ability } = watch([rule]);

			expect(ability.can("update", "post", postBy(admin))).toBe(true);
			expect(seen[0]?.rule).toBe(rule);
		});

		it("reports the deny that matched through a to-many relation", () => {
			const permit = allow("update", "post");
			const forbid = deny("update", "post", {
				where: { comments: { some: { spam: { eq: true } } } },
			});
			const { seen, ability } = watch([permit, forbid]);
			const spammed = postBy(admin, [{ id: "c1", postId: "p1", spam: true }]);

			expect(ability.can("update", "post", spammed)).toBe(false);
			expect(seen[0]?.rule).toBe(forbid);
		});

		it("reports the no when a relation condition simply did not match", () => {
			const { seen, ability } = watch([
				allow("update", "post", {
					where: { author: { role: { eq: "admin" } } },
				}),
			]);

			expect(ability.can("update", "post", postBy(editor))).toBe(false);
			expect(seen[0]).toEqual({
				action: "update",
				resource: "post",
				allowed: false,
			});
		});

		it("stays silent when an unloaded relation stops the check", () => {
			const { seen, ability } = watch([
				allow("update", "post", {
					where: { author: { role: { eq: "admin" } } },
				}),
			]);
			const unloaded: Post = { id: "p1", authorId: "u1", status: "draft" };

			expect(() => ability.can("update", "post", unloaded)).toThrow(
				RelationNotLoadedError,
			);
			expect(seen).toEqual([]);
		});
	});

	describe("with rules that speak about the payload", () => {
		it("keeps a payload-scoped deny out of the row answer", () => {
			const permit = allow("update", "post");
			const { seen, ability } = watch([
				permit,
				deny("update", "post", { payload: { fields: ["status"] } }),
			]);

			expect(ability.can("update", "post", postBy(admin))).toBe(true);
			expect(seen[0]).toEqual({
				action: "update",
				resource: "post",
				allowed: true,
				rule: permit,
			});
		});

		it("reports the field a payload deny refused", () => {
			const { seen, ability } = watch([
				allow("update", "post", {
					payload: { fields: ["status", "authorId"] },
				}),
				deny("update", "post", { payload: { fields: ["authorId"] } }),
			]);
			const row = postBy(admin);

			expect(
				ability.validatePayload("update", "post", row, { status: "published" })
					.ok,
			).toBe(true);
			expect(
				ability.validatePayload("update", "post", row, { authorId: "u9" }).ok,
			).toBe(false);

			expect(seen.map((decision) => decision.allowed)).toEqual([true, false]);
		});

		it("reports a value the payload constraints refused", () => {
			const { seen, ability } = watch([
				allow("update", "post", {
					payload: {
						fields: ["status"],
						constraints: { status: { eq: "draft" } },
					},
				}),
			]);
			const row = postBy(admin);

			expect(
				ability.validatePayload("update", "post", row, { status: "draft" }).ok,
			).toBe(true);
			expect(
				ability.validatePayload("update", "post", row, { status: "published" })
					.ok,
			).toBe(false);

			expect(seen.map((decision) => decision.allowed)).toEqual([true, false]);
		});

		it("reports the row gate for a mutation, with the rule that settled it", () => {
			const forbid = deny("update", "post", {
				where: { status: { eq: "draft" } },
			});
			const { seen, ability } = watch([allow("update", "post"), forbid]);

			expect(ability.canMutate("update", "post", postBy(admin))).toBe(false);
			expect(seen[0]).toEqual({
				action: "update",
				resource: "post",
				allowed: false,
				rule: forbid,
			});
		});
	});

	describe("on data that is not a row at all", () => {
		it("reports the refusal, naming no rule but saying why", () => {
			const { seen, ability } = watch([allow("read", "post")]);

			expect(ability.can("read", "post", "not a row" as unknown as Post)).toBe(
				false,
			);
			expect(seen[0]).toEqual({
				action: "read",
				resource: "post",
				allowed: false,
				reason: "not a plain row",
			});
		});
	});
});

describe("a refusal by field says which field", () => {
	const row: Post = { id: "p1", authorId: "u1", status: "draft" };

	it("names the field a substituted value tried to reach", () => {
		const { seen, ability } = watch([
			allow("update", "post", { payload: { fields: ["status"] } }),
		]);

		expect(
			ability.validatePayload("update", "post", row, { authorId: "someone" })
				.ok,
		).toBe(false);

		expect(seen).toEqual([
			{
				action: "update",
				resource: "post",
				allowed: false,
				violations: [{ field: "authorId", reason: "field not permitted" }],
			},
		]);
	});

	it("names the value a constraint refused", () => {
		const { seen, ability } = watch([
			allow("update", "post", {
				payload: {
					fields: ["status"],
					constraints: { status: { eq: "draft" } },
				},
			}),
		]);

		ability.validatePayload("update", "post", row, { status: "published" });

		expect(seen[0]?.violations).toEqual([
			{ field: "status", reason: "value not permitted" },
		]);
	});

	it("carries nothing extra when the payload passed", () => {
		const { seen, ability } = watch([
			allow("update", "post", { payload: { fields: ["status"] } }),
		]);

		ability.validatePayload("update", "post", row, { status: "published" });

		expect(seen).toEqual([
			{ action: "update", resource: "post", allowed: true },
		]);
	});

	it("keeps violations out of a decision about rows", () => {
		const { seen, ability } = watch([allow("update", "post")]);

		ability.canMutate("update", "post", row);

		expect(seen[0] && "violations" in seen[0]).toBe(false);
	});
});
