import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type {
	CheckedRule,
	CheckedRules,
} from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import {
	ForbiddenError,
	RelationNotLoadedError,
} from "../../src/errors/index.js";

type Post = {
	authorId: string;
	status: "draft" | "published";
	title: string;
};

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update", "delete", "view"],
			relations: {
				post: {
					resource: "post",
					kind: "many",
				},
			},
		},
	},
});

const { allow } = createRules(ac);

const post: Post = { authorId: "u1", status: "published", title: "hi" };

const ability = buildAbility(ac, [
	allow("read", "post"),
	allow("update", "post", {
		where: { authorId: { eq: "u1" } },
		payload: { fields: ["title"] },
	}),
	allow("view", "post", {
		where: {
			or: [
				{ authorId: { eq: "u1" } },
				{
					and: [
						{
							status: "published",
							title: "hi",
						},
					],
				},
			],
		},
	}),

	// @ts-expect-error 'create' is not in the schema (a dirty rule from the DB)
	allow("create", "post"),
	// @ts-expect-error 'comment' is not in the schema (a dirty rule from the DB)
	allow("update", "comment", {
		where: { is: { eq: "a" } },
	}),
]);

describe("buildAbility — typed AbilitySet", () => {
	it("exposes its rules", () => {
		expect(ability.rules).toHaveLength(5);
	});

	describe("can / cannot", () => {
		it("delegates to evaluation, narrowed per resource", () => {
			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("update", "post", post)).toBe(true);

			const foreignPost = { ...post, authorId: "u2" };
			expect(ability.can("update", "post", foreignPost)).toBe(false);
			expect(ability.cannot("update", "post", foreignPost)).toBe(true);
		});

		it("returns false for actions without explicitly defined rules", () => {
			expect(ability.can("delete", "post", post)).toBe(false);
			expect(ability.cannot("delete", "post", post)).toBe(true);
		});
	});

	describe("can / cannot without an instance (optimistic UI gating)", () => {
		it("is true when an allow exists and no blanket deny overrides it", () => {
			expect(ability.can("read", "post")).toBe(true);
			expect(ability.can("update", "post")).toBe(true);
		});

		it("is false when no allow rule matches the action", () => {
			expect(ability.can("delete", "post")).toBe(false);
			expect(ability.cannot("delete", "post")).toBe(true);
		});

		it("is false when a blanket (unconditional) deny is present", () => {
			const { allow: localAllow, deny: localDeny } = createRules(ac);
			const guarded = buildAbility(ac, [
				localAllow("read", "post"),
				localDeny("read", "post"),
			]);
			expect(guarded.can("read", "post")).toBe(false);
		});
	});

	describe("authorize", () => {
		it("does not throw when the action is permitted", () => {
			expect(() => ability.authorize("read", "post", post)).not.toThrow();
		});

		it("throws ForbiddenError when the action is denied", () => {
			const foreignPost = { ...post, authorId: "u2" };
			expect(() => ability.authorize("update", "post", foreignPost)).toThrow(
				ForbiddenError,
			);
		});

		it("carries action and resource on the error", () => {
			expect.assertions(4);
			try {
				ability.authorize("delete", "post", post);
			} catch (error) {
				expect(error).toBeInstanceOf(ForbiddenError);
				const forbidden = error as ForbiddenError;
				expect(forbidden.action).toBe("delete");
				expect(forbidden.resource).toBe("post");
				expect(forbidden.violations).toBeUndefined();
			}
		});
	});

	describe("canMutate", () => {
		it("checks the row against mutation rules", () => {
			expect(ability.canMutate("update", "post", post)).toBe(true);
			expect(
				ability.canMutate("update", "post", { ...post, authorId: "u2" }),
			).toBe(false);
		});

		it("accepts a partial candidate row (pre-insert create flow)", () => {
			const candidate: Partial<Post> = { authorId: "u1" };
			expect(ability.canMutate("update", "post", candidate)).toBe(true);
			expect(
				ability.validatePayload("update", "post", candidate, { title: "x" }),
			).toEqual({ ok: true, data: { title: "x" } });
		});
	});

	describe("complex where conditions (nested OR/AND)", () => {
		it("evaluates deep logical conditions correctly (allow if owner OR (published AND correct title))", () => {
			expect(ability.canMutate("view", "post", post)).toBe(true);
			expect(
				ability.canMutate("view", "post", {
					...post,
					authorId: "u2",
					title: "h",
				}),
			).toBe(false);

			expect(
				ability.canMutate("view", "post", {
					...post,
					authorId: "u2",
					title: "hi",
					status: "published",
				}),
			).toBe(true);
		});
	});

	describe("Handling of dirty/legacy rules (Runtime safety)", () => {
		it("evaluates rules that exist in runtime but are invalid in strict schema", () => {
			// @ts-expect-error
			expect(ability.canMutate("create", "post", post)).toBe(true);

			// @ts-expect-error
			expect(ability.canMutate("update", "comment", post)).toBe(false);
		});
	});

	describe("Handling of malformed runtime data (Edge cases)", () => {
		it("safely denies access when instance is missing strictly evaluated fields", () => {
			const malformedPost = {} as Record<string, unknown>;
			// @ts-expect-error garbage instance (Record instead of Post) — runtime fail-closed check
			expect(ability.can("update", "post", malformedPost)).toBe(false);
		});

		it("safely denies access when instance is completely null", () => {
			const nullPost = null;
			// @ts-expect-error null instead of an instance — the engine must not crash
			expect(() => ability.can("update", "post", nullPost)).not.toThrow();
			// @ts-expect-error null instead of an instance — fail-closed (false)
			expect(ability.can("update", "post", nullPost)).toBe(false);
		});
	});

	describe("validatePayload", () => {
		it("allows permitted fields", () => {
			expect(
				ability.validatePayload("update", "post", post, { title: "new" }),
			).toEqual({ ok: true, data: { title: "new" } });
		});

		it("rejects restricted fields", () => {
			expect(
				ability.validatePayload("update", "post", post, { status: "draft" }),
			).toEqual({
				ok: false,
				violations: [{ field: "status", reason: "field not permitted" }],
			});
		});

		it("rejects payload entirely if it contains at least one restricted field mixed with permitted ones", () => {
			expect(
				ability.validatePayload("update", "post", post, {
					title: "new title",
					status: "draft",
				}),
			).toEqual({
				ok: false,
				violations: [{ field: "status", reason: "field not permitted" }],
			});
		});

		it("allows empty payloads", () => {
			expect(ability.validatePayload("update", "post", post, {})).toEqual({
				ok: true,
				data: {},
			});
		});

		it("rejects payload fields that are completely unknown to the strict schema but not explicitly allowed", () => {
			expect(
				ability.validatePayload("update", "post", post, {
					// @ts-expect-error 'someGarbage' is not a schema field (garbage from the network)
					someGarbage: "hack",
				}),
			).toEqual({
				ok: false,
				violations: [{ field: "someGarbage", reason: "field not permitted" }],
			});
		});

		it("gracefully handles null or non-object payloads (Fail-Closed)", () => {
			// @ts-expect-error
			const result = ability.validatePayload("update", "post", post, null);
			expect(result.ok).toBe(false);
		});
	});

	describe("permittedFields", () => {
		it("filters requested fields against the rule's permitted fields", () => {
			const fields = ability.permittedFields("update", "post", [
				"title",
				"status",
			]);
			expect(fields).toEqual(["title"]);
		});

		it("returns the requested fields if no specific payload restriction exists", () => {
			const fields = ability.permittedFields("read", "post", ["title"]);
			expect(fields).toEqual(["title"]);
		});

		it("types the result as the fields that were asked about", () => {
			const asked: "title"[] = ability.permittedFields("update", "post", [
				"title",
			]);

			expect(asked).toEqual(["title"]);
		});
	});

	describe("validate (trust gate)", () => {
		it("fails closed if the resource is not in the registry", () => {
			// @ts-expect-error unregistered resource
			const result = ability.validate("unknown", { foo: "bar" });
			expect(result).toEqual({
				ok: false,
				issues: [{ message: 'unknown resource "unknown"' }],
			});
		});

		it("passes object data through the phantom schema of a known resource", () => {
			expect(ability.validate("post", { authorId: "u1" })).toEqual({
				ok: true,
				value: { authorId: "u1" },
			});
		});
	});

	describe("where", () => {
		it("compiles condition node for given action and resource", () => {
			const condition = ability.where("update", "post");
			expect(condition).toEqual({
				field: "authorId",
				op: "eq",
				value: "u1",
			});
		});

		it("returns restrictive condition node for actions without rules", () => {
			const condition = ability.where("delete", "post");
			expect(condition).toEqual({ or: [] });
		});
	});

	describe("Empty rules (Default Deny)", () => {
		it("denies all operations when ability set is initialized with empty rules", () => {
			const emptyAbility = buildAbility(ac, []);
			expect(emptyAbility.can("read", "post", post)).toBe(false);
			expect(emptyAbility.canMutate("update", "post", post)).toBe(false);
		});
	});
});

describe("buildAbility — tolerates rules outside the registry", () => {
	it("keeps dirty rules as-is — does not throw, drop, or warn", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const dirty = buildAbility(ac, [
			{ effect: "allow", action: "read", resource: "post" },
			{ effect: "allow", action: "create", resource: "post" },
			{ effect: "deny", action: "delete", resource: "psot" },
		] as CheckedRules);
		expect(dirty.rules).toHaveLength(3);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("AbilitySet — relations via the where builder", () => {
	const relationAbility = buildAbility(ac, [
		allow("read", "post", {
			where: { post: { some: { status: { eq: "published" } } } },
		}),
	]);

	it("allows when a loaded to-many relation satisfies the condition", () => {
		const withRelation = {
			...post,
			post: [
				{ authorId: "u2", status: "draft", title: "a" },
				{ authorId: "u3", status: "published", title: "b" },
			],
		};
		expect(relationAbility.can("read", "post", withRelation)).toBe(true);
	});

	it("denies when no related record satisfies the condition", () => {
		const withRelation = {
			...post,
			post: [{ authorId: "u2", status: "draft", title: "a" }],
		};
		expect(relationAbility.can("read", "post", withRelation)).toBe(false);
	});

	it("throws RelationNotLoadedError when the relation is not loaded", () => {
		expect(() => relationAbility.can("read", "post", post)).toThrow(
			RelationNotLoadedError,
		);
	});
});

describe("authorize without an instance", () => {
	const acPost = defineAbilities({
		resources: {
			post: { schema: shape<{ id: string }>(), actions: ["create"] },
		},
	});
	const { allow } = createRules(acPost);

	it("passes when the action is possible at all", () => {
		const ability = buildAbility(acPost, [allow("create", "post")]);
		expect(() => ability.authorize("create", "post")).not.toThrow();
	});

	it("throws when no rule allows the action", () => {
		const ability = buildAbility(acPost, []);
		expect(() => ability.authorize("create", "post")).toThrow(ForbiddenError);
	});
});

describe("ability.rules is ready for the client", () => {
	it("keeps the checked brand, so it can be handed to a provider", () => {
		const acPost = defineAbilities({
			resources: {
				post: { schema: shape<{ id: string }>(), actions: ["read"] },
			},
		});
		const { allow } = createRules(acPost);
		const ability = buildAbility(acPost, [allow("read", "post")]);

		expectTypeOf(ability.rules).toEqualTypeOf<readonly CheckedRule[]>();
		expect(() => buildAbility(acPost, ability.rules)).not.toThrow();
	});
});
