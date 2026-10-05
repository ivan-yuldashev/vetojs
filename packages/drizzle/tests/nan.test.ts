import { PGlite } from "@electric-sql/pglite";
import {
	buildAbility,
	type CheckedRules,
	defineAbilities,
	type Rule,
	shape,
} from "@vetojs/core";
import { sql } from "drizzle-orm";
import {
	doublePrecision,
	integer,
	numeric,
	PgDialect,
	pgTable,
	text,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";

type Txn = {
	id: string;
	amount: number | null;
	score: number | null;
	count: number | null;
};

const ac = defineAbilities({
	resources: { txn: { schema: shape<Txn>(), actions: ["read"] } },
});

const txns = pgTable("txns", {
	id: text("id").primaryKey(),
	amount: numeric("amount", { mode: "number" }),
	score: doublePrecision("score"),
	count: integer("count"),
});

const dialect = new PgDialect();
const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
	await db.execute(sql`
		create table txns (
			id text primary key,
			amount numeric,
			score double precision,
			count integer
		)
	`);
	await db.execute(sql`
		insert into txns (id, amount, score, count) values
			('sound', 5000, 5000, 5000),
			('small', 10, 10, 10),
			('nan', 'NaN', 'NaN', 7),
			('empty', null, null, null)
	`);
});

afterAll(async () => {
	await client.close();
});

const identical = async (rules: Rule[]): Promise<string[]> => {
	const ability = buildAbility(ac, rules as CheckedRules);
	const engine = (await db.select().from(txns))
		.filter((row) => ability.can("read", "txn", row))
		.map((row) => row.id)
		.sort();

	const filter = toDrizzle(ability.where("read", "txn"), txns);
	const selected = await db.select({ id: txns.id }).from(txns).where(filter);

	expect(selected.map((row) => row.id).sort()).toEqual(engine);

	return engine;
};

const rule = (
	effect: "allow" | "deny",
	field: string,
	op: string,
	value: unknown,
): Rule => ({
	effect,
	action: "read",
	resource: "txn",
	where: { field, op: op as never, value },
});

const vetoed = (field: string, op: string, value: unknown): Rule[] => [
	{ effect: "allow", action: "read", resource: "txn" },
	rule("deny", field, op, value),
];

const permitted = (field: string, op: string, value: unknown): Rule[] => [
	rule("allow", field, op, value),
];

const ORDERING = ["gt", "gte", "lt", "lte"];

describe("a NaN the database can hold", () => {
	it("is what Postgres orders above everything, which the engine does not", async () => {
		const answered = await db.execute(sql`
			select
				('NaN'::numeric > 1000) as above,
				('NaN'::numeric < 1000) as below,
				('NaN'::numeric = 'NaN'::numeric) as same
		`);

		expect(answered.rows[0]).toEqual({ above: true, below: false, same: true });
	});

	for (const field of ["amount", "score"]) {
		for (const op of ORDERING) {
			it(`${op} on a ${field} column answers alike under allow and under deny`, async () => {
				await identical(permitted(field, op, 1000));
				await identical(vetoed(field, op, 1000));
			});
		}
	}

	it("hides the NaN row from a query that grants by an upper bound", async () => {
		expect(await identical(permitted("amount", "gt", 1000))).toEqual(["sound"]);
	});

	it("keeps the NaN row out when a deny names any bound", async () => {
		for (const op of ORDERING) {
			expect(await identical(vetoed("amount", op, 1000))).not.toContain("nan");
		}
	});

	it("leaves the rows it can order exactly where they were", async () => {
		expect(await identical(permitted("amount", "lt", 1000))).toEqual(["small"]);
		expect(await identical(vetoed("amount", "lt", 1000))).toEqual([
			"empty",
			"sound",
		]);
	});

	it("answers equality with it unknown, as it answers an ordering", async () => {
		for (const field of ["amount", "score"]) {
			expect(await identical(permitted(field, "eq", 5000))).toEqual(["sound"]);
			expect(await identical(vetoed(field, "eq", 5000))).toEqual([
				"empty",
				"small",
			]);
			expect(await identical(permitted(field, "ne", 5000))).toEqual([
				"empty",
				"small",
			]);
			expect(await identical(vetoed(field, "ne", 5000))).toEqual(["sound"]);
			expect(await identical(permitted(field, "in", [10, 5000]))).toEqual([
				"small",
				"sound",
			]);
			expect(await identical(vetoed(field, "in", [10, 5000]))).toEqual([
				"empty",
			]);
		}
	});

	it("does not reach for a NaN test on a column that cannot hold one", async () => {
		const filter = toDrizzle(
			buildAbility(ac, permitted("count", "gt", 1000) as CheckedRules).where(
				"read",
				"txn",
			),
			txns,
		);

		expect(
			filter === undefined ? "" : dialect.sqlToQuery(filter).sql,
		).not.toContain("NaN");
		expect(await identical(permitted("count", "gt", 1000))).toEqual(["sound"]);
	});
});

describe("a NaN carried by the rule itself", () => {
	it("orders nothing, under allow or deny", async () => {
		for (const op of ORDERING) {
			expect(await identical(permitted("amount", op, Number.NaN))).toEqual([]);
			expect(await identical(vetoed("amount", op, Number.NaN))).toEqual([
				"empty",
			]);
		}
	});

	it("is equal to nothing and different from nothing, so it decides only the NULL row", async () => {
		expect(await identical(permitted("amount", "eq", Number.NaN))).toEqual([]);
		expect(await identical(vetoed("amount", "eq", Number.NaN))).toEqual([
			"empty",
		]);
		expect(await identical(permitted("amount", "ne", Number.NaN))).toEqual([
			"empty",
		]);
		expect(await identical(vetoed("amount", "ne", Number.NaN))).toEqual([]);
	});

	it("leaves a list unknown wherever no other member matches", async () => {
		expect(await identical(permitted("amount", "in", [Number.NaN]))).toEqual(
			[],
		);
		expect(
			await identical(permitted("amount", "in", [Number.NaN, 10])),
		).toEqual(["small"]);
		expect(await identical(vetoed("amount", "in", [Number.NaN, 10]))).toEqual([
			"empty",
		]);
		expect(
			await identical(permitted("amount", "nin", [Number.NaN, 10])),
		).toEqual(["empty"]);
	});

	it("carries an invalid date the same way", async () => {
		for (const op of ORDERING) {
			await identical(permitted("amount", op, new Date("not-a-date")));
			await identical(vetoed("amount", op, new Date("not-a-date")));
		}
	});
});
