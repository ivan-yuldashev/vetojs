import { describe, expect, it } from "vitest";
import type { RulesByEffect } from "../../src/compile/index.js";
import { createSelect } from "../../src/compile/index.js";
import type { ConditionNode, Row, Rule } from "../../src/model/index.js";

const rule = (
	effect: string,
	action: Rule["action"],
	resource: string,
	where?: ConditionNode<Row>,
): Rule =>
	({
		effect,
		action,
		resource,
		...(where === undefined ? {} : { where }),
	}) as Rule;

const named = (selected: RulesByEffect) => ({
	allow: selected.allow.map((compiled) => compiled.rule),
	deny: selected.deny.map((compiled) => compiled.rule),
});

const readPost = rule("allow", "read", "post");
const updatePost = rule("allow", "update", "post");
const readComment = rule("allow", "read", "comment");
const listed = rule("allow", ["read", "update"], "post");
const managing = rule("allow", "manage", "post");
const managingInList = rule("allow", ["read", "manage"], "post");
const noRead = rule("deny", "read", "post");
const noManaging = rule("deny", "manage", "post");

describe("the rules a pair selects", () => {
	it("takes the rules that name the action and the resource, in the order written", () => {
		const select = createSelect([
			readComment,
			noRead,
			updatePost,
			readPost,
			listed,
		]);

		expect(named(select("read", "post"))).toEqual({
			allow: [readPost, listed],
			deny: [noRead],
		});
		expect(named(select("update", "post"))).toEqual({
			allow: [updatePost, listed],
			deny: [],
		});
		expect(named(select("read", "comment"))).toEqual({
			allow: [readComment],
			deny: [],
		});
	});

	it("takes every action of a list, and only those", () => {
		const select = createSelect([listed]);

		expect(named(select("read", "post")).allow).toEqual([listed]);
		expect(named(select("update", "post")).allow).toEqual([listed]);
		expect(named(select("delete", "post")).allow).toEqual([]);
	});

	it("takes a rule that says manage for any action of its resource", () => {
		const select = createSelect([
			managing,
			managingInList,
			noManaging,
			readComment,
		]);

		for (const action of ["read", "update", "archive"]) {
			expect(named(select(action, "post"))).toEqual({
				allow: [managing, managingInList],
				deny: [noManaging],
			});
		}

		expect(named(select("read", "comment"))).toEqual({
			allow: [readComment],
			deny: [],
		});
	});

	it("takes a manage rule beside the rules that name the action", () => {
		const select = createSelect([readPost, noManaging, updatePost]);

		expect(named(select("read", "post"))).toEqual({
			allow: [readPost],
			deny: [noManaging],
		});
		expect(named(select("delete", "post"))).toEqual({
			allow: [],
			deny: [noManaging],
		});
	});

	it("takes nothing for a question about manage itself", () => {
		const select = createSelect([managing, readPost, noManaging]);

		expect(named(select("manage", "post"))).toEqual({ allow: [], deny: [] });
	});

	it("takes nothing for a pair no rule names", () => {
		const select = createSelect([readPost, managing]);

		expect(named(select("read", "ghost"))).toEqual({ allow: [], deny: [] });
		expect(named(createSelect([readPost])("update", "post"))).toEqual({
			allow: [],
			deny: [],
		});
		expect(named(createSelect([])("read", "post"))).toEqual({
			allow: [],
			deny: [],
		});
	});

	it("takes names nobody declared as names like any other", () => {
		const archive = rule("allow", "archive", "post");
		const ghost = rule("allow", "read", "ghost");
		const select = createSelect([archive, ghost]);

		expect(named(select("archive", "post")).allow).toEqual([archive]);
		expect(named(select("read", "ghost")).allow).toEqual([ghost]);
		expect(named(select("read", "post")).allow).toEqual([]);
	});

	it("takes nothing from a list emptied past the checks", () => {
		const select = createSelect([rule("allow", [] as never, "post")]);

		expect(named(select("read", "post")).allow).toEqual([]);
	});

	it("files a rule under deny unless its effect is exactly allow", () => {
		const odd = rule("Allow", "read", "post");
		const blank = rule("", "read", "post");

		expect(named(createSelect([odd, blank])("read", "post"))).toEqual({
			allow: [],
			deny: [odd, blank],
		});
	});
});

describe("a selection asked for again", () => {
	it("answers each pair for itself, whatever was asked before", () => {
		const select = createSelect([readPost, updatePost, readComment]);
		const asked: [string, string, Rule[]][] = [
			["read", "post", [readPost]],
			["read", "comment", [readComment]],
			["read", "post", [readPost]],
			["update", "post", [updatePost]],
			["read", "post", [readPost]],
			["update", "comment", []],
			["update", "post", [updatePost]],
		];

		for (const [action, resource, allow] of asked) {
			expect(named(select(action, resource)).allow).toEqual(allow);
		}
	});

	it("hands back the same selection for the same pair", () => {
		const select = createSelect([readPost, updatePost]);
		const first = select("read", "post");

		select("update", "post");

		expect(select("read", "post")).toBe(first);
	});
});

describe("the relations a selection reaches", () => {
	const spam: ConditionNode<Row> = { field: "spam", op: "eq", value: true };
	const admin: ConditionNode<Row> = { field: "role", op: "eq", value: "admin" };

	it("collects each relation the conditions of the pair go through", () => {
		const select = createSelect([
			rule("allow", "read", "post", {
				relation: "author",
				type: "one",
				where: admin,
			}),
			rule("deny", "read", "post", {
				relation: "comments",
				type: "many",
				match: "some",
				where: spam,
			}),
			rule("allow", "update", "post", {
				relation: "editors",
				type: "many",
				match: "some",
				where: admin,
			}),
		]);

		expect(select("read", "post").reaches).toEqual([
			{ relation: "author", kind: "one", through: [] },
			{ relation: "comments", kind: "many", through: [] },
		]);
	});

	it("looks under and, or and not, and through a relation into the next", () => {
		const select = createSelect([
			rule("allow", "read", "post", {
				and: [
					{ field: "id", op: "eq", value: "p1" },
					{
						or: [
							{ not: { relation: "author", type: "one", where: admin } },
							{
								relation: "blog",
								type: "one",
								where: {
									relation: "workspace",
									type: "one",
									where: { field: "plan", op: "eq", value: "pro" },
								},
							},
						],
					},
				],
			}),
		]);

		expect(select("read", "post").reaches).toEqual([
			{ relation: "author", kind: "one", through: [] },
			{
				relation: "blog",
				kind: "one",
				through: [{ relation: "workspace", kind: "one", through: [] }],
			},
		]);
	});

	it("merges two conditions through one relation", () => {
		const select = createSelect([
			rule("allow", "read", "post", {
				relation: "comments",
				type: "many",
				match: "some",
				where: spam,
			}),
			rule("deny", "read", "post", {
				relation: "comments",
				type: "many",
				match: "every",
				where: { relation: "author", type: "one", where: admin },
			}),
		]);

		expect(select("read", "post").reaches).toEqual([
			{
				relation: "comments",
				kind: "many",
				through: [{ relation: "author", kind: "one", through: [] }],
			},
		]);
	});

	it("reaches nothing for conditions on fields alone, or for no condition", () => {
		const select = createSelect([
			rule("allow", "read", "post", { field: "id", op: "eq", value: "p1" }),
			readPost,
		]);

		expect(select("read", "post").reaches).toEqual([]);
	});
});
