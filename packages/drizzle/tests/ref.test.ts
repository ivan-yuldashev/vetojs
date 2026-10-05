import { PGlite } from "@electric-sql/pglite";
import {
	buildAbility,
	type CheckedRules,
	createRules,
	defineAbilities,
	type Rule,
	shape,
} from "@vetojs/core";
import { sql } from "drizzle-orm";
import {
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";

type Budget = {
	id: string;
	spent: number | null;
	cap: number | null;
	rate: number | null;
	ceiling: number | null;
	opened: Date | null;
	closed: Date | null;
};

const ac = defineAbilities({
	resources: { budget: { schema: shape<Budget>(), actions: ["read"] } },
});

const budgets = pgTable("budgets", {
	id: text("id").primaryKey(),
	spent: integer("spent"),
	cap: integer("cap"),
	rate: numeric("rate", { mode: "number" }),
	ceiling: numeric("ceiling", { mode: "number" }),
	opened: timestamp("opened", { mode: "date" }),
	closed: timestamp("closed", { mode: "date" }),
});

const at = (ms: number) => new Date(ms);

const rows: Budget[] = [
	{
		id: "under",
		spent: 5,
		cap: 10,
		rate: 1.5,
		ceiling: 2.5,
		opened: at(1000),
		closed: at(2000),
	},
	{
		id: "level",
		spent: 10,
		cap: 10,
		rate: 2,
		ceiling: 2,
		opened: at(2000),
		closed: at(2000),
	},
	{
		id: "over",
		spent: 15,
		cap: 10,
		rate: 3,
		ceiling: 2,
		opened: at(3000),
		closed: at(2000),
	},
	{
		id: "left null",
		spent: null,
		cap: 10,
		rate: null,
		ceiling: 2,
		opened: null,
		closed: at(2000),
	},
	{
		id: "right null",
		spent: 5,
		cap: null,
		rate: 2,
		ceiling: null,
		opened: at(1000),
		closed: null,
	},
	{
		id: "both null",
		spent: null,
		cap: null,
		rate: null,
		ceiling: null,
		opened: null,
		closed: null,
	},
	{
		id: "nan",
		spent: 1,
		cap: 1,
		rate: Number.NaN,
		ceiling: 2,
		opened: at(1),
		closed: at(1),
	},
	{
		id: "nan both",
		spent: 1,
		cap: 1,
		rate: Number.NaN,
		ceiling: Number.NaN,
		opened: at(1),
		closed: at(1),
	},
];

const literal = (value: unknown): string => {
	if (value === null) {
		return "null";
	}

	if (value instanceof Date) {
		return `'${value.toISOString()}'`;
	}

	if (typeof value === "number" && Number.isNaN(value)) {
		return "'NaN'";
	}

	return typeof value === "string" ? `'${value}'` : String(value);
};

const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
	await db.execute(sql`
		create table budgets (
			id text primary key,
			spent integer,
			cap integer,
			rate numeric,
			ceiling numeric,
			opened timestamp,
			closed timestamp
		)
	`);

	for (const row of rows) {
		const values = [
			row.id,
			row.spent,
			row.cap,
			row.rate,
			row.ceiling,
			row.opened,
			row.closed,
		]
			.map(literal)
			.join(", ");

		await db.execute(sql.raw(`insert into budgets values (${values})`));
	}
});

afterAll(async () => {
	await client.close();
});

const identical = async (rules: Rule[]): Promise<string[]> => {
	const ability = buildAbility(ac, rules as CheckedRules);
	const engine = (await db.select().from(budgets))
		.filter((row) => ability.can("read", "budget", row))
		.map((row) => row.id)
		.sort();
	const selected = await db
		.select({ id: budgets.id })
		.from(budgets)
		.where(toDrizzle(ability.where("read", "budget"), budgets));

	expect(selected.map((row) => row.id).sort()).toEqual(engine);

	return engine;
};

const compare = (field: string, op: string, ref: string) => ({
	field,
	op: op as "eq",
	ref,
});

const permitted = (field: string, op: string, ref: string): Rule[] => [
	{
		effect: "allow",
		action: "read",
		resource: "budget",
		where: compare(field, op, ref) as never,
	},
];

const vetoed = (field: string, op: string, ref: string): Rule[] => [
	{ effect: "allow", action: "read", resource: "budget" },
	{
		effect: "deny",
		action: "read",
		resource: "budget",
		where: compare(field, op, ref) as never,
	},
];

const OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte"];

describe("a column compared with another column", () => {
	for (const [left, right] of [
		["spent", "cap"],
		["rate", "ceiling"],
		["opened", "closed"],
	]) {
		for (const op of OPERATORS) {
			it(`${left} ${op} ${right} selects what the engine allows, under allow and under deny`, async () => {
				await identical(permitted(left as string, op, right as string));
				await identical(vetoed(left as string, op, right as string));
			});
		}
	}

	it("grants by the comparison and refuses where a side is missing", async () => {
		expect(await identical(permitted("spent", "lte", "cap"))).toEqual([
			"level",
			"nan",
			"nan both",
			"under",
		]);
		expect(await identical(vetoed("spent", "gt", "cap"))).toEqual([
			"level",
			"nan",
			"nan both",
			"under",
		]);
		expect(await identical(permitted("rate", "eq", "ceiling"))).toEqual([
			"level",
		]);
	});

	it("refuses a column the table does not have", () => {
		expect(() =>
			toDrizzle({ field: "spent", op: "lte", ref: "budget" } as never, budgets),
		).toThrow('column "budget" does not exist');
	});
});

describe("a numeric column in the mode Drizzle reads it by default", () => {
	type Invoice = { id: string; spent: number; limit: number };

	const invoiceAc = defineAbilities({
		resources: { invoice: { schema: shape<Invoice>(), actions: ["update"] } },
	});
	const invoices = pgTable("invoices", {
		id: text("id").primaryKey(),
		spent: numeric("spent", { precision: 12, scale: 2 }),
		limit: numeric("limit", { precision: 12, scale: 2 }),
	});

	beforeAll(async () => {
		await db.execute(sql`
			create table invoices (id text primary key, spent numeric(12, 2), "limit" numeric(12, 2))
		`);
		await db.execute(sql`
			insert into invoices values ('over', 10000, 9000), ('under', 999, 1000)
		`);
	});

	it("selects the rows can() allows on the rows Drizzle loads, and never the one over its limit", async () => {
		const { allow } = createRules(invoiceAc);
		const ability = buildAbility(invoiceAc, [
			allow("update", "invoice", {
				where: { spent: { lte: { ref: "limit" } } },
			}),
		]);
		const engine = (await db.select().from(invoices))
			.filter((row) => ability.can("update", "invoice", row as never))
			.map((row) => row.id)
			.sort();
		const selected = await db
			.select({ id: invoices.id })
			.from(invoices)
			.where(toDrizzle(ability.where("update", "invoice"), invoices));

		expect(selected.map((row) => row.id).sort()).toEqual(engine);
		expect(engine).not.toContain("over");
	});
});
