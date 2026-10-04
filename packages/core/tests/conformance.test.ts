import { describe, expect, it } from "vitest";
import { compileMatcher } from "../src/compile/index.js";
import type { ConditionNode, Rule } from "../src/model/index.js";
import { evaluateRules, select } from "./select.js";

type Post = {
	authorId: string;
	status: "draft" | "published" | "archived";
	views: number;
};

const instances: unknown[] = [
	{ authorId: "u1", status: "draft", views: 10 },
	{ authorId: "u1", status: "published", views: 200 },
	{ authorId: "u2", status: "published", views: 50 },
	{ authorId: "u2", status: "archived", views: 0 },
	{ authorId: "u2", status: ["published"], views: 50 },
	{ authorId: ["u1"], status: "published", views: 200 },
	{ authorId: "u1", status: "published", views: "200" },
	{ authorId: "u1", status: "published" },
	{ authorId: "u1", status: null, views: 5 },
	{ authorId: "u1", status: "published", views: null },
];

const cases: { name: string; action: string; rules: Rule<Post>[] }[] = [
	{
		name: "single conditional allow",
		action: "read",
		rules: [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
		],
	},
	{
		name: "multiple allows (OR)",
		action: "read",
		rules: [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
		],
	},
	{
		name: "allow AND NOT conditional deny",
		action: "update",
		rules: [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
			{
				effect: "deny",
				action: "update",
				resource: "post",
				where: { field: "status", op: "eq", value: "archived" },
			},
		],
	},
	{
		name: "unconditional allow (manage) + conditional deny",
		action: "delete",
		rules: [
			{ effect: "allow", action: "manage", resource: "post" },
			{
				effect: "deny",
				action: "delete",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
		],
	},
	{
		name: "default-deny (no allow)",
		action: "read",
		rules: [
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "draft" },
			},
		],
	},
	{
		name: "unconditional deny",
		action: "read",
		rules: [
			{ effect: "allow", action: "read", resource: "post" },
			{ effect: "deny", action: "read", resource: "post" },
		],
	},
	{
		name: "numeric range allow",
		action: "read",
		rules: [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "views", op: "gte", value: 50 },
			},
		],
	},
	{
		name: "allow + contains deny (type-confusion vector)",
		action: "read",
		rules: [
			{ effect: "allow", action: "read", resource: "post" },
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "status", op: "contains", value: "publish" },
			},
		],
	},
	{
		name: "allow + ne deny (type-confusion vector)",
		action: "read",
		rules: [
			{ effect: "allow", action: "read", resource: "post" },
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "status", op: "ne", value: "published" },
			},
		],
	},
	{
		name: "allow + payload-scoped deny (restricts fields, not rows)",
		action: "update",
		rules: [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
			{
				effect: "deny",
				action: "update",
				resource: "post",
				fields: ["status"],
			},
		],
	},
	{
		name: "allow + payload-scoped deny carrying a where",
		action: "update",
		rules: [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				where: { field: "status", op: "eq", value: "archived" },
				fields: ["status"],
			},
		],
	},
];

describe("conformance: instance-walk vs compiled where()", () => {
	for (const { name, action, rules } of cases) {
		it(name, () => {
			const condition = select(rules, action, "post").where;
			for (const instance of instances) {
				const walk = evaluateRules(
					select(rules, action, "post"),
					instance,
				).allowed;
				const query = compileMatcher(condition)(instance as never);
				expect(query === true).toBe(walk);
			}
		});
	}
});

type Node = ConditionNode<Record<string, unknown>>;
const someClassified: Node = {
	relation: "tags",
	type: "many",
	match: "some",
	where: { field: "classified", op: "eq", value: true },
};
const everyPublic: Node = {
	relation: "tags",
	type: "many",
	match: "every",
	where: { field: "public", op: "eq", value: true },
};
const noneUnresolved: Node = {
	relation: "comments",
	type: "many",
	match: "none",
	where: { field: "resolved", op: "eq", value: false },
};
const deepWorkspace: Node = {
	relation: "blog",
	type: "one",
	where: {
		relation: "workspace",
		type: "one",
		where: { field: "id", op: "eq", value: "w1" },
	},
};

const relationCases: { name: string; action: string; rules: Rule[] }[] = [
	{
		name: "allow some-classified",
		action: "read",
		rules: [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: someClassified,
			},
		],
	},
	{
		name: "allow every-public",
		action: "read",
		rules: [
			{ effect: "allow", action: "read", resource: "post", where: everyPublic },
		],
	},
	{
		name: "allow none-unresolved",
		action: "delete",
		rules: [
			{
				effect: "allow",
				action: "delete",
				resource: "post",
				where: noneUnresolved,
			},
		],
	},
	{
		name: "allow deep blog.workspace.id (to-one x2)",
		action: "read",
		rules: [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: deepWorkspace,
			},
		],
	},
	{
		name: "manage + deny nested relation in or",
		action: "read",
		rules: [
			{ effect: "allow", action: "manage", resource: "post" },
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { or: [someClassified, deepWorkspace] },
			},
		],
	},
];

const relationRows: unknown[] = [
	{
		tags: [{ classified: true, public: false }],
		comments: [{ resolved: true }],
		blog: { workspace: { id: "w1" } },
	},
	{
		tags: [{ classified: false, public: true }],
		comments: [{ resolved: false }],
		blog: { workspace: { id: "w2" } },
	},
	{ tags: [], comments: [], blog: null },
	{
		tags: [{ classified: ["x"], public: true }],
		comments: [{ resolved: false }],
		blog: { workspace: { id: "w1" } },
	},
	{
		tags: [{ public: true }, true],
		comments: [{ resolved: true }],
		blog: { workspace: { id: "w1" } },
	},
	{
		tags: [{ classified: true, public: true }],
		comments: [],
		blog: [{ workspace: { id: "w1" } }],
	},
];

describe("conformance: relations (walk vs compiled where())", () => {
	for (const { name, action, rules } of relationCases) {
		it(name, () => {
			const condition = select(rules, action, "post").where;
			for (const row of relationRows) {
				const walk = evaluateRules(select(rules, action, "post"), row).allowed;
				const query = compileMatcher(condition)(row as never);
				expect(query === true).toBe(walk);
			}
		});
	}
});
