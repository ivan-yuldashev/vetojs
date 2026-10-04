import { describe, expect, expectTypeOf, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { CheckedRule, Rule } from "../../src/model/index.js";

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
			allow(
				["update", "publish"],
				{ post: ["status", "views"] },
				{
					values: {
						status: { in: ["draft", "published"] },
					},
				},
			),
		).toEqual({
			effect: "allow",
			action: ["update", "publish"],
			resource: "post",
			fields: ["status", "views"],
			values: {
				field: "status",
				op: "in",
				value: ["draft", "published"],
			},
		});
	});

	it("deny builds a deny rule", () => {
		expect(deny("update", { post: ["views"] })).toEqual({
			effect: "deny",
			action: "update",
			resource: "post",
			fields: ["views"],
		});
	});

	it("does not compile an empty where, which would widen the rule to every row", () => {
		const written = () =>
			// @ts-expect-error a where describes at least one condition
			allow("read", "post", { where: {} });

		expect(written).toBeTypeOf("function");
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

		expect(allow("read", "post")).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
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
				values: {
					and: [{ views: { gt: 5 } }, { views: { lt: 10 } }],
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
			values: {
				and: [
					{ field: "views", op: "gt", value: 5 },
					{ field: "views", op: "lt", value: 10 },
				],
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
				values: { publishedAt: { in: [moment] } },
			}),
		).toEqual({
			effect: "allow",
			action: "update",
			resource: "post",
			where: { field: "publishedAt", op: "lt", value: moment.getTime() },
			values: {
				field: "publishedAt",
				op: "in",
				value: [moment.getTime()],
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
		const unreadable = () => {
			allow(
				"update",
				{ post: ["status"] },
				// @ts-expect-error values take a condition, and the type says which
				{ values: "garbage" },
			);
		};

		expect(unreadable).toBeTypeOf("function");
	});

	it("does not compile a constraint shorthand that names nothing", () => {
		const written = () =>
			// @ts-expect-error values describe at least one constraint
			allow("update", "post", { values: {} });

		expect(written).toBeTypeOf("function");
	});

	it("refuses a field list that names nothing", () => {
		// @ts-expect-error a field list is a tuple, so the compiler settles this one
		allow("update", { post: [] });
		// @ts-expect-error the same on the other effect
		deny("update", { post: [] });
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
		rules.allow("update", "doc", {  values: { tags: ["a"] } });
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
				values: { status: { in: ["draft", "published"] } },
			}),
		).toMatchObject({
			values: { field: "status", op: "in" },
		});
	});
});

describe("a rule's condition on the environment", () => {
	const envAc = defineAbilities({
		env: shape<{ hour: number; region: string }>(),
		resources: { post: { schema: shape<Post>(), actions: ["read"] } },
	});
	const onEnv = createRules(envAc);

	it("compiles to field nodes, and is taken only from the options themselves", () => {
		expect(
			onEnv.allow("read", "post", { when: { hour: { gte: 9 }, region: "eu" } }),
		).toEqual({
			effect: "allow",
			action: "read",
			resource: "post",
			when: {
				and: [
					{ field: "hour", op: "gte", value: 9 },
					{ field: "region", op: "eq", value: "eu" },
				],
			},
		});

		(Object.prototype as Record<string, unknown>).when = { region: "eu" };

		try {
			expect(Object.hasOwn(onEnv.allow("read", "post", {}), "when")).toBe(
				false,
			);
		} finally {
			delete (Object.prototype as Record<string, unknown>).when;
		}
	});

	it("names when in a refusal", () => {
		expect(() =>
			onEnv.allow("read", "post", { when: { region: undefined } as never }),
		).toThrow("veto: when.region is undefined");
	});
});
