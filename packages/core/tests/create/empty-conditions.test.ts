import { describe, expect, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";

type Blog = { id: string; archived: boolean };
type Comment = { spam: boolean };
type Post = {
	id: string;
	status: string;
	views: number;
	blog: Blog;
	comments: Comment[];
};

const ac = defineAbilities({
	resources: {
		blog: { schema: shape<Blog>(), actions: ["read"] },
		comment: { schema: shape<Comment>(), actions: ["read"] },
		post: {
			schema: shape<Post>(),
			actions: ["update"],
			relations: {
				blog: { resource: "blog", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
	},
});

const { allow, deny } = createRules(ac);

export const saysNothing = () => {
	// @ts-expect-error an empty where would widen the rule to every row
	allow("update", "post", { where: {} });
	// @ts-expect-error the same silence on a deny opens the row instead
	deny("update", "post", { where: {} });

	// @ts-expect-error an empty group covers everything
	allow("update", "post", { where: { and: [] } });
	// @ts-expect-error an empty group covers nothing
	allow("update", "post", { where: { or: [] } });

	// @ts-expect-error empty one level down is still empty
	allow("update", "post", { where: { and: [{}] } });
	// @ts-expect-error and two levels down
	allow("update", "post", { where: { or: [{ and: [{}] }] } });

	// @ts-expect-error a negation of nothing
	allow("update", "post", { where: { not: {} } });
	// @ts-expect-error a relation asked nothing about
	allow("update", "post", { where: { blog: {} } });
	// @ts-expect-error a quantifier over nothing
	allow("update", "post", { where: { comments: { some: {} } } });

	const detached = { where: {} };

	// @ts-expect-error through a variable, not only inline
	allow("update", "post", detached);

	// @ts-expect-error a target naming no field
	deny("update", { post: [] });
	// @ts-expect-error values constraining nothing
	deny("update", "post", { values: {} });
	// @ts-expect-error an empty group of values
	deny("update", "post", { values: { and: [] } });

	allow(
		"update",
		{ post: ["status"] },
		// @ts-expect-error a permission cannot constrain a field it does not name
		{ values: { views: { gt: 1 } } },
	);

	// @ts-expect-error two operators naming one field
	allow("update", "post", { where: { views: { gt: 1, lt: 5 } } });

	// @ts-expect-error a field the resource does not have
	allow("update", { post: ["nope"] });
	// @ts-expect-error an action the resource does not declare
	allow("archive", { post: ["status"] });
};

describe("what still compiles, because it says something", () => {
	it("takes a field, a group, a negation and a relation", () => {
		expect(
			allow("update", "post", { where: { status: "draft" } }),
		).toBeTruthy();
		expect(
			allow("update", "post", {
				where: { and: [{ status: "draft" }, { views: { gt: 10 } }] },
			}),
		).toBeTruthy();
		expect(
			allow("update", "post", { where: { not: { status: "draft" } } }),
		).toBeTruthy();
		expect(
			allow("update", "post", { where: { blog: { archived: false } } }),
		).toBeTruthy();
		expect(
			allow("update", "post", {
				where: { comments: { some: { spam: true } } },
			}),
		).toBeTruthy();
	});

	it("takes a target with fields, values, or both", () => {
		expect(deny("update", { post: ["status"] })).toBeTruthy();
		expect(
			deny("update", "post", { values: { views: { gt: 1 } } }),
		).toBeTruthy();
		expect(
			deny("update", { post: ["status"] }, { values: { status: "archived" } }),
		).toBeTruthy();
	});

	it("takes two independent subtractions in one deny", () => {
		const rule = deny(
			"update",
			{ post: ["status"] },
			{ values: { views: { gt: 1 } } },
		);

		expect(rule.fields).toEqual(["status"]);
		expect(rule.values).toEqual({ field: "views", op: "gt", value: 1 });
	});

	it("takes a row condition and a target with fields", () => {
		expect(
			allow("update", { post: ["status"] }, { where: { status: "draft" } }),
		).toBeTruthy();
	});
});

describe("a field takes one operator", () => {
	it("refuses two of them, and takes either alone", () => {
		expect(
			allow("update", "post", { where: { views: { gt: 1 } } }),
		).toBeTruthy();
		expect(allow("update", "post", { where: { lt: 5 } as never })).toBeTruthy();
	});
});
