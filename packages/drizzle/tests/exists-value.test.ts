import { PGlite } from "@electric-sql/pglite";
import {
	buildAbility,
	type CheckedRules,
	defineAbilities,
	type Rule,
	shape,
} from "@vetojs/core";
import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";

type Post = { id: string; deletedAt: string | null; views: number | null };

const ac = defineAbilities({
	resources: { post: { schema: shape<Post>(), actions: ["read"] } },
});

const posts = pgTable("posts", {
	id: text("id").primaryKey(),
	deletedAt: text("deleted_at"),
	views: integer("views"),
});

const rows: Post[] = [
	{ id: "live", deletedAt: null, views: 3 },
	{ id: "gone", deletedAt: "2026-01-01", views: 0 },
];

const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
	await db.execute(sql`
		create table posts (
			id text primary key,
			deleted_at text,
			views integer
		)
	`);
	await db.insert(posts).values(rows);
});

afterAll(async () => {
	await client.close();
});

const identical = async (rules: Rule[]): Promise<string[]> => {
	const ability = buildAbility(ac, rules as CheckedRules);
	const engine = rows
		.filter((row) => ability.can("read", "post", row))
		.map((row) => row.id)
		.sort();

	const filter = toDrizzle(ability.where("read", "post"), posts);
	const selected = await db.select({ id: posts.id }).from(posts).where(filter);

	expect(selected.map((row) => row.id).sort()).toEqual(engine);

	return engine;
};

const asked = (value: unknown, effect: "allow" | "deny" = "allow"): Rule[] =>
	[
		...(effect === "deny"
			? [{ effect: "allow", action: "read", resource: "post" }]
			: []),
		{
			effect,
			action: "read",
			resource: "post",
			where: { field: "deletedAt", op: "exists", value },
		},
	] as Rule[];

describe("exists against the database", () => {
	it("selects the rows that carry the field", async () => {
		expect(await identical(asked(true))).toEqual(["gone"]);
	});

	it("selects the rows that do not", async () => {
		expect(await identical(asked(false))).toEqual(["live"]);
	});

	it("selects nothing when the rule's value is not a boolean", async () => {
		for (const value of ["false", "0", "", 0, 1, [], {}, null]) {
			expect(await identical(asked(value))).toEqual([]);
		}
	});

	it("hides every row when such a rule is a prohibition", async () => {
		for (const value of ["false", "0", 1]) {
			expect(await identical(asked(value, "deny"))).toEqual([]);
		}
	});

	it("keeps a deny on a well-formed exists exactly as it was", async () => {
		expect(await identical(asked(true, "deny"))).toEqual(["live"]);
		expect(await identical(asked(false, "deny"))).toEqual(["gone"]);
	});
});
