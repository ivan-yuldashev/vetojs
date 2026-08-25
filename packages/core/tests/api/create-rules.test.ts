import { describe, expect, expectTypeOf, it } from "vitest";
import type { CheckedRule } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import type { Rule } from "../../src/model/index.js";

type Post = {
	authorId: string;
	status: "draft" | "published";
	views: number;
	publishedAt: Date;
};

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update", "publish"],
		},
	},
});

const { allow, deny } = createRules(ac);

describe("createRules", () => {
	it("allow builds an allow rule", () => {
		expect(allow("read", "post")).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
		});
	});

	it("compiles the where shorthand into AST", () => {
		expect(
			allow("update", "post", { where: { authorId: { eq: "u1" } } }),
		).toEqual({
			effect: "allow",
			action: "update",
			resource: "post",
			where: { field: "authorId", op: "eq", value: "u1" },
		});
	});

	it("compiles payload fields and constraints", () => {
		expect(
			allow(["update", "publish"], "post", {
				payload: {
					fields: ["status", "views"],
					constraints: {
						status: { in: ["draft", "published"] },
					},
				},
			}),
		).toEqual({
			effect: "allow",
			action: ["update", "publish"],
			resource: "post",
			payload: {
				fields: ["status", "views"],
				constraints: {
					field: "status",
					op: "in",
					value: ["draft", "published"],
				},
			},
		});
	});

	it("deny builds a deny rule", () => {
		expect(deny("update", "post", { payload: { fields: ["views"] } })).toEqual({
			effect: "deny",
			action: "update",
			resource: "post",
			payload: { fields: ["views"] },
		});
	});

	it("treats an empty where as unconditional and omits it", () => {
		expect(allow("read", "post", { where: {} })).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
		});
	});

	it("returns a plain Rule that collects into a policy array", () => {
		const policy: Rule[] = [allow("read", "post"), deny("update", "post")];
		expect(policy).toHaveLength(2);
		expectTypeOf(allow("read", "post")).toEqualTypeOf<CheckedRule>();
	});

	it("handles empty options gracefully without creating undefined properties", () => {
		expect(allow("read", "post", {})).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
		});

		expect(allow("read", "post", { payload: {} })).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
			payload: {},
		});
	});

	it("handles an array of actions", () => {
		expect(allow(["read", "update"], "post")).toEqual({
			effect: "allow",
			action: ["read", "update"],
			resource: "post",
		});
	});

	it("compiles complex logical operators in both where and payload shorthands", () => {
		expect(
			allow("update", "post", {
				where: {
					and: [
						{ status: { in: ["draft"] } },
						{ or: [{ authorId: { eq: "u1" } }, { authorId: { eq: "u2" } }] },
					],
				},
				payload: {
					constraints: {
						and: [{ views: { gt: 5 } }, { views: { lt: 10 } }],
					},
				},
			}),
		).toEqual({
			effect: "allow",
			action: "update",
			resource: "post",
			where: {
				and: [
					{ field: "status", op: "in", value: ["draft"] },
					{
						or: [
							{ field: "authorId", op: "eq", value: "u1" },
							{ field: "authorId", op: "eq", value: "u2" },
						],
					},
				],
			},
			payload: {
				constraints: {
					and: [
						{ field: "views", op: "gt", value: 5 },
						{ field: "views", op: "lt", value: 10 },
					],
				},
			},
		});
	});

	it("compiles multiple fields into an implicit AND condition", () => {
		expect(
			deny("update", "post", {
				where: {
					authorId: "u2",
					status: "draft",
				},
			}),
		).toEqual({
			effect: "deny",
			action: "update",
			resource: "post",
			where: {
				and: [
					{ field: "authorId", op: "eq", value: "u2" },
					{ field: "status", op: "eq", value: "draft" },
				],
			},
		});
	});

	it("normalizes Date values to epoch milliseconds in where and payload", () => {
		const moment = new Date("2026-01-01T00:00:00.000Z");
		expect(
			allow("update", "post", {
				where: { publishedAt: { lt: moment } },
				payload: { constraints: { publishedAt: { in: [moment] } } },
			}),
		).toEqual({
			effect: "allow",
			action: "update",
			resource: "post",
			where: { field: "publishedAt", op: "lt", value: moment.getTime() },
			payload: {
				constraints: {
					field: "publishedAt",
					op: "in",
					value: [moment.getTime()],
				},
			},
		});
	});

	it("normalizes a direct Date value (implicit eq) to epoch milliseconds", () => {
		const moment = new Date("2026-01-01T00:00:00.000Z");
		expect(allow("read", "post", { where: { publishedAt: moment } })).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
			where: { field: "publishedAt", op: "eq", value: moment.getTime() },
		});
	});

	it("refuses payload constraints it cannot read", () => {
		expect(() =>
			allow("update", "post", {
				payload: { fields: ["status"], constraints: "garbage" as never },
			}),
		).toThrow(TypeError);
	});

	it("carries no constraint when the shorthand names none", () => {
		expect(
			allow("update", "post", { payload: { constraints: {} } }).payload,
		).toEqual({});
	});
});

describe("array-valued fields take membership operators only", () => {
	type Doc = {
		id: string;
		tags: string[];
		meta: { lang: string };
		status: "draft" | "published";
	};
	const acDoc = defineAbilities({
		resources: { doc: { schema: shape<Doc>(), actions: ["update"] } },
	});
	const rules = createRules(acDoc);

	it("rejects a bare array, which would compare the array as a whole", () => {
		// @ts-expect-error a bare array on an array field means eq
		rules.allow("update", "doc", { where: { tags: ["a", "b"] } });
		// biome-ignore format: the directive must stay on the line that errors
		// @ts-expect-error same in payload constraints
		rules.allow("update", "doc", { payload: { constraints: { tags: ["a"] } } });
	});

	it("rejects whole-array comparison, which could only ever answer unknown", () => {
		// biome-ignore format: the directive must stay on the line that errors
		// @ts-expect-error eq on an array field
		rules.allow("update", "doc", { where: { tags: { eq: ["a", "b"] } } });
		// biome-ignore format: the directive must stay on the line that errors
		// @ts-expect-error in on an array field
		rules.allow("update", "doc", { where: { tags: { in: [["a"], ["b"]] } } });
	});

	it("rejects every operator but exists on an object field", () => {
		// biome-ignore format: the directive must stay on the line that errors
		// @ts-expect-error a nested object is not comparable
		rules.allow("update", "doc", { where: { meta: { eq: { lang: "ru" } } } });

		expect(
			rules.allow("update", "doc", { where: { meta: { exists: true } } }),
		).toMatchObject({ where: { field: "meta", op: "exists" } });
	});

	it("accepts the membership operators", () => {
		expect(
			rules.allow("update", "doc", { where: { tags: { has: "a" } } }),
		).toMatchObject({ where: { field: "tags", op: "has", value: "a" } });
		expect(
			rules.allow("update", "doc", { where: { tags: { hasAny: ["a", "b"] } } }),
		).toMatchObject({ where: { field: "tags", op: "hasAny" } });
		expect(
			rules.allow("update", "doc", { where: { tags: { hasAll: ["a", "b"] } } }),
		).toMatchObject({ where: { field: "tags", op: "hasAll" } });
	});

	it("still accepts a mixed union list for in", () => {
		expect(
			rules.allow("update", "doc", {
				payload: { constraints: { status: { in: ["draft", "published"] } } },
			}),
		).toMatchObject({
			payload: { constraints: { field: "status", op: "in" } },
		});
	});
});
