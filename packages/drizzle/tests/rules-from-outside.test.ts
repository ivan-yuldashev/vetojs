import { PGlite } from "@electric-sql/pglite";
import { buildAbility, defineAbilities, parseRules, shape } from "@vetojs/core";
import { sql } from "drizzle-orm";
import {
	date,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDrizzle } from "../src/compile.js";

type Item = {
	id: string;
	title: string | null;
	count: number | null;
	amount: string | null;
	tags: string[] | null;
	at: Date | null;
	stamp: string | null;
	day: string | null;
};

const ac = defineAbilities({
	resources: { item: { schema: shape<Item>(), actions: ["read"] } },
});

const items = pgTable("items", {
	id: text("id").primaryKey(),
	title: text("title"),
	count: integer("count"),
	amount: numeric("amount"),
	tags: text("tags").array(),
	at: timestamp("at", { mode: "date" }),
	stamp: timestamp("stamp", { mode: "string" }),
	day: date("day"),
});

const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
	await db.execute(sql`
		create table items (
			id text primary key,
			title text,
			count integer,
			amount numeric,
			tags text[],
			at timestamp,
			stamp timestamp,
			day date
		)
	`);
	await db.execute(sql`
		insert into items values
			('a', 'hello', 1, 1.5, '{x}', '2026-01-01', '2026-01-01', '2026-01-01'),
			('b', 'world', 2, 2.5, '{y}', '2026-06-01', '2026-06-01', '2026-06-01'),
			('c', null, null, null, null, null, null, null)
	`);
});

afterAll(async () => {
	await client.close();
});

const outcome = async (rules: unknown[]): Promise<string> => {
	const parsed = parseRules(rules);

	if (!parsed.ok) {
		return `not accepted by parseRules: ${parsed.errors.join("; ")}`;
	}

	const ability = buildAbility(ac, parsed.rules);
	let filter: ReturnType<typeof toDrizzle>;

	try {
		filter = toDrizzle(ability.where("read", "item"), items);
	} catch (error) {
		const message = (error as Error).message;

		return message.startsWith("veto:")
			? "refused"
			: `${(error as Error).constructor.name}: ${message}`;
	}

	const engine = (await db.select().from(items))
		.filter((row) => ability.can("read", "item", row))
		.map((row) => row.id)
		.sort();

	try {
		const selected = (
			await db.select({ id: items.id }).from(items).where(filter)
		)
			.map((row) => row.id)
			.sort();

		return selected.join() === engine.join()
			? "faithful"
			: `SQL selects [${selected}], can() allows [${engine}]`;
	} catch (error) {
		const cause = (error as Error & { cause?: Error }).cause ?? error;

		return `the query failed: ${(cause as Error).message}`;
	}
};

const SOUND = { field: "id", op: "eq", value: "c" };

const permitted = (where: object) => [
	{ effect: "allow", action: "read", resource: "item", where: SOUND },
	{ effect: "allow", action: "read", resource: "item", where },
];

const vetoed = (where: object) => [
	{ effect: "allow", action: "read", resource: "item" },
	{ effect: "deny", action: "read", resource: "item", where },
];

describe("a rule parseRules accepts, on a column it does not fit", () => {
	const cases: [name: string, where: object][] = [
		[
			"hasAll of nothing on a text column",
			{ field: "title", op: "hasAll", value: [] },
		],
		[
			"hasAny of nothing on a text column",
			{ field: "title", op: "hasAny", value: [] },
		],
		["has on a text column", { field: "title", op: "has", value: "x" }],
		["has on a timestamp column", { field: "at", op: "has", value: "x" }],
		[
			"hasAny on a timestamp column",
			{ field: "at", op: "hasAny", value: ["x"] },
		],
		[
			"eq with a string on an array column",
			{ field: "tags", op: "eq", value: "x" },
		],
		[
			"ne with a string on an array column",
			{ field: "tags", op: "ne", value: "x" },
		],
		[
			"in with strings on an array column",
			{ field: "tags", op: "in", value: ["x"] },
		],
		[
			"eq with a number past the integer range",
			{ field: "count", op: "eq", value: 3000000000 },
		],
		[
			"gt with a number past the integer range",
			{ field: "count", op: "gt", value: 3000000000 },
		],
		[
			"eq with a word on a numeric column",
			{ field: "amount", op: "eq", value: "abc" },
		],
		[
			"gt with a word on a numeric column",
			{ field: "amount", op: "gt", value: "abc" },
		],
		[
			"eq with a word on a timestamp read as a string",
			{ field: "stamp", op: "eq", value: "x" },
		],
		[
			"gt with a word on a timestamp read as a string",
			{ field: "stamp", op: "gt", value: "x" },
		],
		[
			"eq with a word on a date read as a string",
			{ field: "day", op: "eq", value: "x" },
		],
	];

	for (const [name, where] of cases) {
		it(`${name}: is refused while the query is built, or selects what can() allows`, async () => {
			expect(["refused", "faithful"]).toContain(
				await outcome(permitted(where)),
			);
			expect(["refused", "faithful"]).toContain(await outcome(vetoed(where)));
		});
	}
});
