import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type {
	CheckedRules,
	ConditionNode,
	Row,
} from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";
import { type Answer, answerOf } from "../verdict-of.js";

const ref = (field: string, op: string, other: string) =>
	({ field, op, ref: other }) as ConditionNode<Row>;

describe("a field compared with another field of the same row", () => {
	const table: [op: string, spent: unknown, limit: unknown, answer: Answer][] =
		[
			["eq", 5, 5, "yes"],
			["eq", 5, 6, "no"],
			["ne", 5, 6, "yes"],
			["ne", 5, 5, "no"],
			["gt", 6, 5, "yes"],
			["gt", 5, 5, "no"],
			["gte", 5, 5, "yes"],
			["gte", 4, 5, "no"],
			["lt", 4, 5, "yes"],
			["lt", 5, 5, "no"],
			["lte", 5, 5, "yes"],
			["lte", 6, 5, "no"],
			["lte", 5n, 6, "yes"],
			["lte", new Date(1000), new Date(2000), "yes"],
			["eq", new Date(1000), 1000, "yes"],
			["lte", "a", "b", "unknown"],
			["eq", "a", "a", "yes"],
		];

	it.each(
		table,
	)("%s of %s against %s answers %s", (op, spent, limit, answer) => {
		expect(
			answerOf(ref("spent", op, "limit"), { id: "p1", spent, limit }),
		).toBe(answer);
	});

	const lacking: [name: string, row: Row][] = [
		["the field is absent", { id: "p1", limit: 5 }],
		["the other field is absent", { id: "p1", spent: 5 }],
		["the field is null", { id: "p1", spent: null, limit: 5 }],
		["the other field is null", { id: "p1", spent: 5, limit: null }],
		["both are null", { id: "p1", spent: null, limit: null }],
		["both are undefined", { id: "p1", spent: undefined, limit: undefined }],
		["the field is NaN", { id: "p1", spent: Number.NaN, limit: 5 }],
		["both are NaN", { id: "p1", spent: Number.NaN, limit: Number.NaN }],
	];

	it.each(
		lacking,
	)("answers unknown when %s, under every operator", (_, row) => {
		for (const op of ["eq", "ne", "gt", "gte", "lt", "lte"]) {
			expect({ op, answer: answerOf(ref("spent", op, "limit"), row) }).toEqual({
				op,
				answer: "unknown",
			});
		}
	});

	it("answers as a value would when the two sides cannot be compared", () => {
		expect(
			answerOf(ref("spent", "gt", "limit"), { id: "p1", spent: 5, limit: "5" }),
		).toBe("unknown");
		expect(
			answerOf(ref("spent", "eq", "limit"), { id: "p1", spent: {}, limit: {} }),
		).toBe("unknown");
		for (const op of ["eq", "ne"]) {
			expect(
				answerOf(ref("spent", op, "limit"), { id: "p1", spent: 5, limit: "5" }),
			).toBe("unknown");
			expect(
				answerOf(ref("spent", op, "limit"), {
					id: "p1",
					spent: true,
					limit: "true",
				}),
			).toBe("unknown");
		}
	});

	it("reads only the row's own fields", () => {
		const row = Object.assign(Object.create({ limit: 5 }), {
			id: "p1",
			spent: 5,
		});

		expect(answerOf(ref("spent", "eq", "limit"), row)).toBe("unknown");
	});
});

type Account = { id: string; spent: number; limit: number; plan: string };
type Invoice = {
	id: string;
	amount: number;
	cap: number | null;
	issuedAt: Date;
	dueAt: Date;
	status: string;
	account?: Account | null;
};

const ac = defineAbilities({
	resources: {
		invoice: {
			schema: shape<Invoice>(),
			actions: ["read", "update"],
			relations: { account: { resource: "account", kind: "one" } },
		},
		account: { schema: shape<Account>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const invoice: Invoice = {
	id: "i1",
	amount: 50,
	cap: 100,
	issuedAt: new Date(1000),
	dueAt: new Date(2000),
	status: "open",
	account: { id: "a1", spent: 10, limit: 20, plan: "pro" },
};

describe("writing ref", () => {
	it("compiles to a node that names the other field in place of a value", () => {
		expect(
			allow("read", "invoice", { where: { amount: { lte: { ref: "cap" } } } })
				.where,
		).toEqual({ field: "amount", op: "lte", ref: "cap" });
		expect(
			allow("read", "invoice", {
				where: { account: { spent: { lt: { ref: "limit" } } } },
			}).where,
		).toEqual({
			relation: "account",
			type: "one",
			where: { field: "spent", op: "lt", ref: "limit" },
		});
	});

	it("reads the related row's fields inside a relation", () => {
		const ability = buildAbility(ac, [
			allow("read", "invoice", {
				where: { account: { spent: { lt: { ref: "limit" } } } },
			}),
		]);

		expect(ability.can("read", "invoice", invoice)).toBe(true);
		expect(
			ability.can("read", "invoice", {
				...invoice,
				account: { id: "a1", spent: 30, limit: 20, plan: "pro" },
			}),
		).toBe(false);
	});

	it("lets a deny stand where a side is missing", () => {
		const ability = buildAbility(ac, [
			allow("update", "invoice"),
			deny("update", "invoice", { where: { amount: { gt: { ref: "cap" } } } }),
		]);

		expect(ability.can("update", "invoice", invoice)).toBe(true);
		expect(ability.can("update", "invoice", { ...invoice, amount: 150 })).toBe(
			false,
		);
		expect(ability.can("update", "invoice", { ...invoice, cap: null })).toBe(
			false,
		);
	});

	it("compiles only against a field of the same row with a compatible type", () => {
		const written = () => [
			allow("read", "invoice", {
				where: { dueAt: { gt: { ref: "issuedAt" } } },
			}),
			allow("read", "invoice", { where: { status: { ne: { ref: "id" } } } }),
			allow("read", "invoice", {
				// @ts-expect-error a number is not compared with a date
				where: { amount: { lte: { ref: "dueAt" } } },
			}),
			allow("read", "invoice", {
				// @ts-expect-error the row has no such field
				where: { amount: { lte: { ref: "budget" } } },
			}),
			// @ts-expect-error in takes values, not a field
			allow("read", "invoice", { where: { amount: { in: [{ ref: "cap" }] } } }),
			// @ts-expect-error strings are compared by equality only
			allow("read", "invoice", { where: { status: { gt: { ref: "id" } } } }),
			allow(
				"update",
				{ invoice: ["amount"] },
				// @ts-expect-error a value constraint compares with a value, never with another field
				{ values: { amount: { lte: { ref: "cap" } } } },
			),
		];

		expect(written).toBeTypeOf("function");
	});
});

describe("ref that arrives from outside", () => {
	const rule = (key: "where" | "values", node: unknown) => [
		{ effect: "allow", action: "read", resource: "invoice", [key]: node },
	];

	it("is checked as a comparison of two fields, and only in where", () => {
		const REFUSAL =
			'.ref: names another field to compare with, only in where, under "eq" | "ne" | "gt" | "gte" | "lt" | "lte", and in place of a value';

		expect(
			parseRules(rule("where", { field: "amount", op: "lte", ref: "cap" })).ok,
		).toBe(true);
		expect(
			parseRules(
				rule("where", { field: "amount", op: "lte", ref: "cap", value: 5 }),
			),
		).toEqual({ ok: false, errors: [`rules[0].where${REFUSAL}`] });
		expect(
			parseRules(rule("where", { field: "amount", op: "in", ref: "cap" })),
		).toEqual({
			ok: false,
			errors: [`rules[0].where${REFUSAL}`],
		});
		expect(
			parseRules(rule("where", { field: "amount", op: "lte", ref: "" })),
		).toEqual({
			ok: false,
			errors: [`rules[0].where${REFUSAL}`],
		});
		expect(
			parseRules(rule("values", { field: "amount", op: "lte", ref: "cap" })),
		).toEqual({
			ok: false,
			errors: [`rules[0].values${REFUSAL}`],
		});
	});

	it("survives the trip through JSON", () => {
		const rules = [
			allow("read", "invoice", { where: { amount: { lte: { ref: "cap" } } } }),
		];
		const parsed = parseRules(JSON.parse(JSON.stringify(rules)));

		expect(parsed.ok).toBe(true);
		expect(
			buildAbility(ac, (parsed as { rules: CheckedRules }).rules).can(
				"read",
				"invoice",
				invoice,
			),
		).toBe(true);
	});
});
