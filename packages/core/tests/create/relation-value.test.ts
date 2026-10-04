import { describe, expect, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";

type Post = { id: string; status: string };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read"],
			relations: {
				author: { resource: "user", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		user: { schema: shape<{ id: string }>(), actions: ["read"] },
		comment: { schema: shape<{ id: string }>(), actions: ["read"] },
	},
});

const { allow } = createRules(ac);

describe("a relation takes a condition, and refuses what is not one", () => {
	it("refuses a value beside a field that would otherwise compile alone", () => {
		expect(() =>
			allow("read", "post", {
				where: { status: "draft", comments: 5 } as never,
			}),
		).toThrow(/where\.comments names a relation/);
	});

	it("refuses it on a to-one relation", () => {
		expect(() =>
			allow("read", "post", { where: { author: 5 } as never }),
		).toThrow(/where\.author names a relation/);

		expect(() =>
			allow("read", "post", { where: { author: null } as never }),
		).toThrow(/where\.author names a relation/);
	});

	it("refuses it on a to-many relation", () => {
		expect(() =>
			allow("read", "post", { where: { comments: null } as never }),
		).toThrow(/where\.comments names a relation/);
	});

	it("takes the conditions it is meant to", () => {
		expect(
			allow("read", "post", { where: { author: { id: "u1" } } }).where,
		).toEqual({
			relation: "author",
			type: "one",
			where: { field: "id", op: "eq", value: "u1" },
		});

		expect(
			allow("read", "post", { where: { comments: { some: { id: "c1" } } } })
				.where,
		).toEqual({
			relation: "comments",
			type: "many",
			match: "some",
			where: { field: "id", op: "eq", value: "c1" },
		});
	});
});
