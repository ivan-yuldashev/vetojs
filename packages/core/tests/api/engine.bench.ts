import { bench, describe } from "vitest";
import { compileMatcher } from "../../src/compile/index.js";
import type { ConditionNode, Rule } from "../../src/model/index.js";
import { evaluateRules, select, validatePayload } from "../select.js";

type Post = { authorId: string; status: string; views: number };

const rules: Rule<Post>[] = Array.from({ length: 50 }, (_, index) => ({
	effect: index % 5 === 0 ? "deny" : "allow",
	action: "read",
	resource: "post",
	where: { field: "views", op: "gt", value: index * 10 },
}));

const instance: Post = { authorId: "u1", status: "published", views: 300 };

type Doc = { a: number; b: number; c: number; d: number; e: number };

const mutationRules: Rule<Doc>[] = Array.from({ length: 20 }, (_, index) => ({
	effect: index % 4 === 0 ? "deny" : "allow",
	action: "update",
	resource: "doc",
	fields: ["a", "b", "c", "d", "e"],
	values: {
		and: [
			{ field: "a", op: "gte", value: 0 },
			{ field: "b", op: "lte", value: 100 },
		],
	},
}));

const docRow: Doc = { a: 1, b: 2, c: 3, d: 4, e: 5 };
const docPayload: Partial<Doc> = { a: 10, b: 20, c: 30, d: 40, e: 50 };

type PostWithComments = { authorId: string; comments: { approved: boolean }[] };

const relationNode: ConditionNode<PostWithComments> = {
	and: [
		{ field: "authorId", op: "eq", value: "u1" },
		{
			relation: "comments",
			type: "many",
			match: "every",
			where: { field: "approved", op: "eq", value: true },
		},
	],
};

const postWithComments: PostWithComments = {
	authorId: "u1",
	comments: Array.from({ length: 100 }, () => ({ approved: true })),
};

describe("engine", () => {
	bench("evaluateRules over 50 rules", () => {
		evaluateRules(select(rules, "read", "post"), instance);
	});

	bench("compileWhere over 50 rules", () => {
		select(rules, "read", "post").where;
	});

	bench("validatePayload: 20 rules x 5-key payload", () => {
		validatePayload(select(mutationRules, "update", "doc"), docRow, docPayload);
	});

	bench("evaluateCondition: relation over 100 items (every)", () => {
		compileMatcher(relationNode)(postWithComments);
	});
});
