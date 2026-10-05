import { PGlite } from "@electric-sql/pglite";
import {
	buildAbility,
	type CheckedRules,
	defineAbilities,
	type Rule,
	shape,
} from "@vetojs/core";
import { sql } from "drizzle-orm";
import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";

type Row = { id: string; score: bigint | null };
const ac = defineAbilities({
	resources: { rec: { schema: shape<Row>(), actions: ["read"] } },
});
const recs = pgTable("recs", {
	id: text("id").primaryKey(),
	score: bigint("score", { mode: "bigint" }),
});

const TWO53 = 9007199254740992n;
const rows: Row[] = [
	{ id: "at-2^53", score: TWO53 },
	{ id: "below", score: 10n },
	{ id: "above", score: TWO53 + 2n },
];

const client = new PGlite();
const db = drizzle(client);
beforeAll(async () => {
	await db.execute(sql`create table recs (id text primary key, score bigint)`);
	await db.insert(recs).values(rows);
});
afterAll(async () => client.close());

const identity = async (rules: Rule[]): Promise<void> => {
	const ability = buildAbility(ac, rules as CheckedRules);
	const engine = (await db.select().from(recs))
		.filter((r) => ability.can("read", "rec", r))
		.map((r) => r.id)
		.sort();
	const filter = toDrizzle(ability.where("read", "rec"), recs);
	const out = await db.select({ id: recs.id }).from(recs).where(filter);
	const sqlV = out.map((r) => r.id).sort();
	expect(sqlV).toEqual(engine);
};

describe("numeric boundary: bigint column, number rule value at 2^53", () => {
	it("eq at 2^53 (number rule value from JSON)", async () => {
		await identity([
			{
				effect: "allow",
				action: "read",
				resource: "rec",
				where: { field: "score", op: "eq", value: 9007199254740992 },
			},
		]);
	});

	it("gte at 2^53", async () => {
		await identity([
			{
				effect: "allow",
				action: "read",
				resource: "rec",
				where: { field: "score", op: "gte", value: 9007199254740992 },
			},
		]);
	});

	it("deny eq at 2^53 (fail-open direction)", async () => {
		await identity([
			{ effect: "allow", action: "read", resource: "rec" },
			{
				effect: "deny",
				action: "read",
				resource: "rec",
				where: { field: "score", op: "eq", value: 9007199254740992 },
			},
		]);
	});
});
