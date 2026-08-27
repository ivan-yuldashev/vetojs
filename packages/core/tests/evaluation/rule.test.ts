import { describe, expect, it } from "vitest";
import { evaluateRules, mightAllow } from "../../src/evaluation/rule.js";
import type { Rule } from "../../src/model/index.js";

type Post = {
	authorId: string;
	status: "draft" | "published" | "archived";
};

const post: Post = { authorId: "u1", status: "published" };

describe("evaluateRules", () => {
	describe("instance validation", () => {
		it("safely denies access if the instance is not a plain object", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "read", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", null)).toBe(false);
			expect(evaluateRules(rules, "read", "post", undefined)).toBe(false);
			expect(evaluateRules(rules, "read", "post", [])).toBe(false);
		});
	});

	it("denies by default when no rule matches", () => {
		expect(evaluateRules([], "read", "post", post)).toBe(false);
	});

	it("allows when an unconditional allow matches action and resource", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
		];
		expect(evaluateRules(rules, "read", "post", post)).toBe(true);
	});

	it("denies when the action does not match", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
		];
		expect(evaluateRules(rules, "update", "post", post)).toBe(false);
	});

	it("denies when the resource does not match", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
		];
		expect(evaluateRules(rules, "read", "comment", post)).toBe(false);
	});

	describe("manage", () => {
		it("matches any action for the resource", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "manage", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", post)).toBe(true);
			expect(evaluateRules(rules, "delete", "post", post)).toBe(true);
		});

		it("does not cross resources", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "manage", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "comment", post)).toBe(false);
		});
	});

	describe("action lists", () => {
		it("matches any action in the list", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: ["update", "publish"], resource: "post" },
			];
			expect(evaluateRules(rules, "publish", "post", post)).toBe(true);
			expect(evaluateRules(rules, "delete", "post", post)).toBe(false);
		});

		it("matches if 'manage' is present inside an action array", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: ["read", "manage"], resource: "post" },
			];
			expect(evaluateRules(rules, "delete", "post", post)).toBe(true);
		});

		it("ignores rules with an empty action array", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: [], resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", post)).toBe(false);
		});
	});

	describe("where", () => {
		it("allows only when the row condition holds", () => {
			const rules: Rule<Post>[] = [
				{
					effect: "allow",
					action: "update",
					resource: "post",
					where: { field: "authorId", op: "eq", value: "u1" },
				},
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(true);
			expect(
				evaluateRules(rules, "update", "post", { ...post, authorId: "u2" }),
			).toBe(false);
		});
	});

	describe("deny override", () => {
		it("an applicable deny overrides an allow", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "read", resource: "post" },
				{ effect: "deny", action: "read", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", post)).toBe(false);
		});

		it("overrides regardless of order", () => {
			const rules: Rule<Post>[] = [
				{ effect: "deny", action: "read", resource: "post" },
				{ effect: "allow", action: "read", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", post)).toBe(false);
		});

		it("a conditional deny only overrides when its condition holds", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					where: { field: "status", op: "eq", value: "archived" },
				},
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(true);
			expect(
				evaluateRules(rules, "update", "post", { ...post, status: "archived" }),
			).toBe(false);
		});

		it("a deny via manage overrides a specific allow", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "read", resource: "post" },
				{ effect: "deny", action: "manage", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", post)).toBe(false);
		});

		it("does not override if deny rule applies to a different action", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "read", resource: "post" },
				{ effect: "deny", action: "update", resource: "post" },
			];
			expect(evaluateRules(rules, "read", "post", post)).toBe(true);
		});
	});

	describe("payload-scoped deny", () => {
		it("a deny carrying only a payload leaves the row decision alone", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					payload: { fields: ["status"] },
				},
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(true);
		});

		it("a where alongside a payload scopes the fields, not the row", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					where: { field: "status", op: "eq", value: "archived" },
					payload: { fields: ["status"] },
				},
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(true);
			expect(
				evaluateRules(rules, "update", "post", { ...post, status: "archived" }),
			).toBe(true);
		});

		it("a deny without a payload still vetoes the action outright", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "update", resource: "post" },
				{ effect: "deny", action: "update", resource: "post" },
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(false);
		});

		it("an empty payload names nothing, so the deny stays a blanket veto", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					payload: {},
				},
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(false);
			expect(mightAllow(rules, "update", "post")).toBe(false);
		});

		it("a payload naming only constraints is still payload-scoped", () => {
			const rules: Rule<Post>[] = [
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					payload: {
						constraints: { field: "status", op: "eq", value: "draft" },
					},
				},
			];
			expect(evaluateRules(rules, "update", "post", post)).toBe(true);
		});
	});
});

describe("mightAllow", () => {
	it("steps over rules about another pair before reaching the allow", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "comment" },
			{ effect: "deny", action: "update", resource: "post" },
			{ effect: "allow", action: "read", resource: "post" },
		];

		expect(mightAllow(rules, "read", "post")).toBe(true);
	});

	it("returns false if there are no rules", () => {
		expect(mightAllow([], "read", "post")).toBe(false);
	});

	it("returns false if no allow rules match the action and resource", () => {
		const rules: Rule<Post>[] = [
			{ effect: "deny", action: "read", resource: "post" },
			{ effect: "allow", action: "update", resource: "post" },
		];
		expect(mightAllow(rules, "read", "post")).toBe(false);
	});

	it("returns true if an allow rule matches and no deny rules exist", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
		];
		expect(mightAllow(rules, "read", "post")).toBe(true);
	});

	it("returns false if an unconditional deny rule matches, regardless of allow rules", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
			{ effect: "deny", action: "read", resource: "post" },
		];
		expect(mightAllow(rules, "read", "post")).toBe(false);
	});

	it("returns true if an allow matches, but the overriding deny rule is conditional", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "archived" },
			},
		];
		expect(mightAllow(rules, "read", "post")).toBe(true);
	});

	it("returns true when the only deny is scoped to a payload", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: { fields: ["status"] },
			},
		];
		expect(mightAllow(rules, "update", "post")).toBe(true);
	});
});
