import { PGlite } from "@electric-sql/pglite";
import {
	buildAbility,
	createRules,
	defineAbilities,
	shape,
} from "@vetojs/core";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";

type Doc = { id: string; labels: string[] | null };
const ac = defineAbilities({
	resources: { doc: { schema: shape<Doc>(), actions: ["read"] } },
});
const { allow } = createRules(ac);
const docs = pgTable("docs", {
	id: text("id").primaryKey(),
	labels: text("labels").array(),
});

const client = new PGlite();
const db = drizzle(client);

const rows: Doc[] = [
	{ id: "quote", labels: ["o'brien"] },
	{ id: "comma", labels: ["a,b"] },
	{ id: "brace", labels: ["{x}"] },
	{ id: "pct", labels: ["100%"] },
	{ id: "bs", labels: ["a\b"] },
	{ id: "inj", labels: ["'); drop table docs; --"] },
	{ id: "plain", labels: ["plain"] },
];

beforeAll(async () => {
	await db.execute(sql`create table docs (id text primary key, labels text[])`);
	await db.insert(docs).values(rows);
});
afterAll(async () => {
	await client.close();
});

const identity = async (value: string) => {
	const ability = buildAbility(ac, [
		allow("read", "doc", { where: { labels: { has: value } } }),
	]);
	const engine = (await db.select().from(docs))
		.filter((r) => ability.can("read", "doc", r))
		.map((r) => r.id)
		.sort();
	const filter = toDrizzle(ability.where("read", "doc"), docs);
	const got = (await db.select({ id: docs.id }).from(docs).where(filter))
		.map((r) => r.id)
		.sort();
	expect(got).toEqual(engine);
	return engine;
};

describe("array elements with awkward characters", () => {
	for (const [label, value] of [
		["single quote", "o'brien"],
		["comma", "a,b"],
		["braces", "{x}"],
		["percent", "100%"],
		["backslash", "a\b"],
		["sql injection attempt", "'); drop table docs; --"],
	] as const) {
		it(label, async () => {
			const visible = await identity(value);
			expect(visible.length).toBe(1);
		});
	}

	it("the table survived", async () => {
		const all = await db.select({ id: docs.id }).from(docs);
		expect(all.length).toBe(rows.length);
	});
});
