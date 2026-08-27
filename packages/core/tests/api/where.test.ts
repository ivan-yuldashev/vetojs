import { describe, expect, it } from "vitest";
import { compileWhere } from "../../src/api/where.js";
import type { Rule } from "../../src/model/index.js";

type Post = { authorId: string; status: string };

describe("compileWhere", () => {
	it("matches nothing when no allow applies (empty or)", () => {
		expect(
			compileWhere<Post>(
				[{ effect: "deny", action: "read", resource: "post" }],
				"read",
				"post",
			),
		).toEqual({ or: [] });
		expect(compileWhere<Post>([], "read", "post")).toEqual({ or: [] });
	});

	it("returns the single condition for one conditional allow", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
		];
		expect(compileWhere(rules, "read", "post")).toEqual({
			field: "status",
			op: "eq",
			value: "published",
		});
	});

	it("ORs multiple allow conditions", () => {
		const rules: Rule<Post>[] = [
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
		];
		expect(compileWhere(rules, "read", "post")).toEqual({
			or: [
				{ field: "status", op: "eq", value: "published" },
				{ field: "authorId", op: "eq", value: "u1" },
			],
		});
	});

	it("collapses an unconditional allow to TRUE (empty and)", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "manage", resource: "post" },
		];
		expect(compileWhere(rules, "read", "post")).toEqual({ and: [] });
	});

	it("combines allow AND NOT deny", () => {
		const rules: Rule<Post>[] = [
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
		];
		expect(compileWhere(rules, "update", "post")).toEqual({
			and: [
				{ field: "authorId", op: "eq", value: "u1" },
				{ not: { field: "status", op: "eq", value: "archived" } },
			],
		});
	});

	it("reduces unconditional allow + deny to NOT deny", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "manage", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				where: { field: "status", op: "eq", value: "archived" },
			},
		];
		expect(compileWhere(rules, "update", "post")).toEqual({
			not: { field: "status", op: "eq", value: "archived" },
		});
	});

	it("matches nothing under an unconditional deny", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
			{ effect: "deny", action: "read", resource: "post" },
		];
		expect(compileWhere(rules, "read", "post")).toEqual({ or: [] });
	});

	it("combines multiple conditional denies into a single NOT OR group", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "read", resource: "post" },
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "draft" },
			},
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "blocked-user" },
			},
		];
		expect(compileWhere(rules, "read", "post")).toEqual({
			not: {
				or: [
					{ field: "status", op: "eq", value: "draft" },
					{ field: "authorId", op: "eq", value: "blocked-user" },
				],
			},
		});
	});

	it("simplifies to TRUE (empty and) when a mix of conditional and unconditional allows exists", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
			{ effect: "allow", action: "read", resource: "post" },
		];
		expect(compileWhere(rules, "read", "post")).toEqual({ and: [] });
	});

	const broken = (effect: "allow" | "deny", where: unknown): Rule<Post> =>
		({
			effect,
			action: "read",
			resource: "post",
			where,
		}) as unknown as Rule<Post>;

	const notConditions = [null, 42, "garbage", [], true];

	it("reads a where that is not a condition object as no condition at all", () => {
		for (const where of notConditions) {
			const label = `where: ${JSON.stringify(where)}`;

			expect(
				compileWhere([broken("allow", where)], "read", "post"),
				label,
			).toEqual({ or: [] });
			expect(
				compileWhere(
					[
						{ effect: "allow", action: "read", resource: "post" },
						broken("deny", where),
					],
					"read",
					"post",
				),
				label,
			).toEqual({ or: [] });
		}
	});

	it("returns FALSE (empty or) if rules exist but for a different action", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
		];
		expect(compileWhere(rules, "read", "post")).toEqual({ or: [] });
	});

	it("correctly builds AST for multiple allows intersected with multiple denies", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "status", op: "eq", value: "archived" },
			},
			{
				effect: "deny",
				action: "read",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "banned" },
			},
		];

		expect(compileWhere(rules, "read", "post")).toEqual({
			and: [
				{
					or: [
						{ field: "authorId", op: "eq", value: "u1" },
						{ field: "status", op: "eq", value: "published" },
					],
				},
				{
					not: {
						or: [
							{ field: "status", op: "eq", value: "archived" },
							{ field: "authorId", op: "eq", value: "banned" },
						],
					},
				},
			],
		});
	});
});
