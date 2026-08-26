import {
	buildAbility,
	type CheckedRules,
	type ConditionNode,
	defineAbilities,
	shape,
} from "@vetojs/core";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";
import { defineTables } from "../src/schema.js";

type Post = { id: string; authorId: string; views: number };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string }>(), actions: ["read"] },
	},
});

const posts = pgTable("posts", {
	id: text("id").primaryKey(),
	authorId: text("author_id"),
	views: integer("views"),
});

const users = pgTable("users", { id: text("id").primaryKey() });

const INHERITED = [
	"constructor",
	"toString",
	"valueOf",
	"hasOwnProperty",
	"__proto__",
] as const;

const node = (field: string): ConditionNode<Record<string, unknown>> =>
	({ field, op: "eq", value: "x" }) as ConditionNode<Record<string, unknown>>;

describe("a name every object inherits is not a column", () => {
	it("is refused like any column the table does not have", () => {
		for (const field of INHERITED) {
			expect(() => toDrizzle(node(field), posts)).toThrow(/does not exist/);
		}

		expect(() => toDrizzle(node("ghost"), posts)).toThrow(/does not exist/);
	});

	it("names the table, so the message is the same one an unknown column gets", () => {
		expect(() => toDrizzle(node("toString"), posts)).toThrow(/"posts"/);
	});

	it("compiles the columns the table really has", () => {
		expect(toDrizzle(node("authorId"), posts)).toBeDefined();
	});

	it("is refused as a relation the registry never declared", () => {
		const schema = defineTables(ac, { post: posts, user: users });

		for (const relation of INHERITED) {
			expect(() =>
				schema.filter(
					buildAbility(ac, [
						{
							effect: "allow",
							action: "read",
							resource: "post",
							where: {
								relation,
								type: "one",
								where: { field: "id", op: "eq", value: "u1" },
							},
						},
					] as CheckedRules),
					"read",
					"post",
				),
			).toThrow(/not declared in the ability registry/);
		}
	});

	it("is refused as a resource the table map never named", () => {
		const schema = defineTables(ac, { post: posts, user: users });

		for (const resource of INHERITED) {
			expect(() =>
				schema.filter(
					buildAbility(ac, [] as CheckedRules),
					"read",
					resource as "post",
				),
			).toThrow();
		}
	});

	it("still filters the resource the map does name", () => {
		const schema = defineTables(ac, { post: posts, user: users });
		const ability = buildAbility(ac, [
			{
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
		] as CheckedRules);

		expect(schema.filter(ability, "read", "post")).toBeDefined();
	});

	it("leaves the prototype alone", () => {
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
});

describe("a column genuinely called that still compiles", () => {
	const hostile = pgTable("hostile", {
		id: text("id").primaryKey(),
		constructor: text("constructor"),
		toString: text("to_string"),
	});

	it("compiles a condition on it", () => {
		expect(toDrizzle(node("constructor"), hostile)).toBeDefined();
		expect(toDrizzle(node("toString"), hostile)).toBeDefined();
	});
});
