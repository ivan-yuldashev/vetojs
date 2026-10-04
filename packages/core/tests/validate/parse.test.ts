import { assert, describe, expect, expectTypeOf, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { CheckedRules, ConditionNode } from "../../src/model/index.js";
import { type CONDITION_SHAPES, parseRules } from "../../src/validate/index.js";

describe("parseRules", () => {
	describe("valid input", () => {
		it("accepts a well-formed rule array", () => {
			const input = [
				{ effect: "allow", action: "read", resource: "post" },
				{
					effect: "deny",
					action: ["update", "publish"],
					resource: "post",
					where: { field: "status", op: "eq", value: "archived" },
					fields: ["title"],
				},
			];
			const result = parseRules(input);
			assert(result.ok);
			expect(result.rules).toEqual(input);
			expectTypeOf(result.rules).toEqualTypeOf<CheckedRules>();
		});

		it("accepts an empty array", () => {
			expect(parseRules([])).toEqual({ ok: true, rules: [] });
		});

		it("accepts nested boolean and relation conditions", () => {
			const input = [
				{
					effect: "allow",
					action: "read",
					resource: "post",
					where: {
						or: [
							{ field: "authorId", op: "eq", value: "u1" },
							{
								not: {
									relation: "comments",
									type: "many",
									match: "some",
									where: { field: "flagged", op: "eq", value: true },
								},
							},
						],
					},
				},
			];
			expect(parseRules(input).ok).toBe(true);
		});
	});

	describe("top-level shape", () => {
		it("rejects non-array input", () => {
			expect(parseRules({})).toEqual({
				ok: false,
				errors: ["expected an array of rules"],
			});
			expect(parseRules(null).ok).toBe(false);
			expect(parseRules("[]").ok).toBe(false);
		});

		it("rejects a non-object rule", () => {
			const result = parseRules([42]);
			assert(!result.ok);
			expect(result.errors).toContain("rules[0]: expected a rule object");
		});

		it("rejects a hole in the list, rather than handing it to the engine", () => {
			const rules: unknown[] = [];
			rules[1] = { effect: "allow", action: "read", resource: "post" };

			const result = parseRules(rules);
			assert(!result.ok);
			expect(result.errors).toEqual(["rules[0]: expected a rule object"]);
		});
	});

	describe("rule fields", () => {
		it("rejects an effect other than allow/deny", () => {
			const result = parseRules([
				{ effect: "Allow", action: "read", resource: "post" },
			]);
			assert(!result.ok);
			expect(result.errors).toContain(
				'rules[0].effect: expected "allow" | "deny"',
			);
		});

		it("rejects a malformed action", () => {
			expect(
				parseRules([{ effect: "allow", action: 1, resource: "post" }]).ok,
			).toBe(false);
			expect(
				parseRules([{ effect: "allow", action: ["read", 2], resource: "post" }])
					.ok,
			).toBe(false);
		});

		it("rejects a missing or non-string resource", () => {
			expect(parseRules([{ effect: "allow", action: "read" }]).ok).toBe(false);
		});
	});

	describe("where conditions", () => {
		it("rejects an unknown operator", () => {
			const result = parseRules([
				{
					effect: "allow",
					action: "read",
					resource: "post",
					where: { field: "x", op: "regex", value: "a" },
				},
			]);
			assert(!result.ok);
			expect(
				result.errors.some((error) => error.includes("unknown operator")),
			).toBe(true);
		});

		it("rejects a node carrying two shapes, which would silently drop one", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: {
							field: "views",
							op: "gt",
							value: 100,
							and: [{ field: "id", op: "eq", value: "p1" }],
						},
					},
				]),
			).toEqual({
				ok: false,
				errors: [
					`rules[0].where: a condition names "and" and "field" at once — a node carries exactly one shape`,
				],
			});
		});

		it("rejects a payload constraint carrying two shapes", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						fields: ["status"],
						values: {
							and: [{ field: "views", op: "lt", value: 1000 }],
							field: "status",
							op: "eq",
							value: "draft",
						},
					},
				]),
			).toEqual({
				ok: false,
				errors: [
					`rules[0].values: a condition names "and" and "field" at once — a node carries exactly one shape`,
				],
			});
		});

		it("rejects a where that is not a condition object at all", () => {
			for (const where of ["garbage", 42, true, null, [], () => true]) {
				expect(
					parseRules([
						{ effect: "allow", action: "read", resource: "post", where },
					]),
				).toEqual({
					ok: false,
					errors: ["rules[0].where: expected a condition object"],
				});
			}
		});

		it("rejects a field node without a string field", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: 1, op: "eq", value: "a" },
					},
				]).ok,
			).toBe(false);
		});

		it("rejects a hole in an and/or", () => {
			const conditions: unknown[] = [];
			conditions[1] = { field: "status", op: "eq", value: "draft" };

			for (const group of ["and", "or"]) {
				const result = parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { [group]: conditions },
					},
				]);
				assert(!result.ok);
				expect(result.errors).toEqual([
					`rules[0].where.${group}[0]: expected a condition object`,
				]);
			}
		});

		it("rejects a non-array and/or", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { and: {} },
					},
				]).ok,
			).toBe(false);
		});
	});

	describe("relations", () => {
		it("rejects a to-many relation with an invalid match", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: {
							relation: "c",
							type: "many",
							match: "all",
							where: { field: "x", op: "eq", value: 1 },
						},
					},
				]).ok,
			).toBe(false);
		});

		it("rejects a to-one relation carrying a match", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: {
							relation: "c",
							type: "one",
							match: "some",
							where: { field: "x", op: "eq", value: 1 },
						},
					},
				]).ok,
			).toBe(false);
		});

		it("rejects a relation of an unknown cardinality", () => {
			const result = parseRules([
				{
					effect: "allow",
					action: "read",
					resource: "post",
					where: {
						relation: "comments",
						type: "several",
						where: { field: "id", op: "eq", value: 1 },
					},
				},
			]);

			expect(result.ok).toBe(false);
			expect(result.ok === false && result.errors).toEqual([
				'rules[0].where.type: expected "one" | "many"',
			]);
		});

		it("rejects a relation whose name is not a string", () => {
			const result = parseRules([
				{
					effect: "allow",
					action: "read",
					resource: "post",
					where: {
						relation: 42,
						type: "one",
						where: { field: "id", op: "eq", value: 1 },
					},
				},
			]);

			expect(result.ok).toBe(false);
			expect(result.ok === false && result.errors).toEqual([
				"rules[0].where.relation: expected a string",
			]);
		});

		it("rejects a relation without where", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { relation: "c", type: "many", match: "some" },
					},
				]).ok,
			).toBe(false);
		});
	});

	describe("payload", () => {
		it("rejects a field list that names nothing", () => {
			const result = parseRules([
				{
					effect: "deny",
					action: "update",
					resource: "post",
					fields: [],
				},
			]);

			expect(result.ok).toBe(false);
			expect(result.ok || result.errors.join(" ")).toMatch(
				/at least one field name/,
			);
		});

		it("refuses a rule written for the build that carried a payload", () => {
			const parsed = parseRules([
				{
					effect: "deny",
					action: "update",
					resource: "post",
					payload: { fields: ["status"] },
				},
			]);

			expect(parsed.ok).toBe(false);
			expect(parsed.ok ? [] : parsed.errors).toEqual([
				expect.stringContaining("rules carry fields and values themselves"),
			]);
		});

		it("rejects non-string payload fields", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						fields: ["title", 2],
					},
				]).ok,
			).toBe(false);
		});

		it("refuses the old key whatever it holds", () => {
			for (const payload of ["garbage", 42, null, ["fields"], {}]) {
				expect(
					parseRules([
						{
							effect: "allow",
							action: "update",
							resource: "post",
							payload,
						},
					]).ok,
				).toBe(false);
			}
		});

		it("rejects a non-array and inside constraints", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						values: { and: "garbage" },
					},
				]),
			).toEqual({
				ok: false,
				errors: ["rules[0].values.and: expected an array"],
			});
		});

		it("rejects constraints that are not a condition at all", () => {
			for (const constraints of ["garbage", 42, ["x"]]) {
				expect(
					parseRules([
						{
							effect: "allow",
							action: "update",
							resource: "post",
							values: constraints,
						},
					]).ok,
				).toBe(false);
			}
		});

		it("accepts field constraints and rejects a relation inside constraints", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						values: { field: "status", op: "in", value: ["draft"] },
					},
				]).ok,
			).toBe(true);
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						values: {
							relation: "c",
							type: "many",
							match: "some",
							where: { field: "x", op: "eq", value: 1 },
						},
					},
				]).ok,
			).toBe(false);
		});
	});

	describe("security & robustness", () => {
		it("rejects a non-array value for in/nin", () => {
			const makeRule = (op: string, value: unknown) => ({
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "role", op, value },
			});

			const forNin = parseRules([makeRule("nin", "admin")]);
			assert(!forNin.ok);
			expect(forNin.errors).toEqual([
				'rules[0].where.value: expected an array for "nin"',
			]);

			expect(parseRules([makeRule("in", "draft")]).ok).toBe(false);
			expect(parseRules([makeRule("in", ["draft"])]).ok).toBe(true);
			expect(parseRules([makeRule("nin", [])]).ok).toBe(true);
		});

		it("rejects a non-array value for hasAny/hasAll too", () => {
			const makeRule = (op: string, value: unknown) => ({
				effect: "allow",
				action: "read",
				resource: "post",
				where: { field: "tags", op, value },
			});

			expect(parseRules([makeRule("hasAny", "a")]).ok).toBe(false);
			expect(parseRules([makeRule("hasAll", "a")]).ok).toBe(false);
			expect(parseRules([makeRule("hasAny", ["a"])]).ok).toBe(true);
			expect(parseRules([makeRule("hasAll", [])]).ok).toBe(true);

			expect(parseRules([makeRule("has", "a")]).ok).toBe(true);
		});

		it("does not treat prototype keys as valid operators", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: "x", op: "constructor", value: 1 },
					},
				]).ok,
			).toBe(false);
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: "x", op: "toString", value: 1 },
					},
				]).ok,
			).toBe(false);
		});

		it("collects multiple errors with paths", () => {
			const result = parseRules([{ effect: "nope", action: 1, resource: 2 }]);
			assert(!result.ok);
			expect(result.errors).toHaveLength(3);
			expect(
				result.errors.every((error) => error.startsWith("rules[0].")),
			).toBe(true);
		});

		it("rejects an over-deep condition instead of throwing (stack-overflow DoS)", () => {
			let node: unknown = { field: "id", op: "eq", value: "x" };
			for (let index = 0; index < 100000; index++) {
				node = { and: [node] };
			}
			const input = [
				{ effect: "allow", action: "read", resource: "post", where: node },
			];

			let result: ReturnType<typeof parseRules> | undefined;
			expect(() => {
				result = parseRules(input);
			}).not.toThrow();
			assert(result !== undefined && !result.ok);
			expect(result.errors.some((error) => /too deep/i.test(error))).toBe(true);
		});

		it("rejects over-deep payload constraints instead of throwing", () => {
			let node: unknown = { field: "views", op: "eq", value: 1 };
			for (let index = 0; index < 100000; index++) {
				node = { and: [node] };
			}
			const input = [
				{
					effect: "allow",
					action: "update",
					resource: "post",
					values: node,
				},
			];
			let result: ReturnType<typeof parseRules> | undefined;
			expect(() => {
				result = parseRules(input);
			}).not.toThrow();
			expect(result?.ok).toBe(false);
		});
	});

	describe("JSON round-trip", () => {
		it("keeps Date-based rules equivalent across a round-trip", () => {
			const ac = defineAbilities({
				resources: {
					task: {
						schema: shape<{ id: string; due: Date }>(),
						actions: ["complete"],
					},
				},
			});
			const { allow, deny } = createRules(ac);
			const rules = [
				allow("complete", "task"),
				deny("complete", "task", {
					where: { due: { lt: new Date("2026-01-01") } },
				}),
			];

			const parsed = parseRules(JSON.parse(JSON.stringify(rules)));
			expect(parsed.ok).toBe(true);
			const rulesAfterRoundTrip = parsed.ok ? parsed.rules : [];

			const before = buildAbility(ac, rules);
			const after = buildAbility(ac, rulesAfterRoundTrip);
			const overdue = { id: "t", due: new Date("2025-06-01") };
			const upcoming = { id: "t", due: new Date("2026-06-01") };

			expect(before.can("complete", "task", overdue)).toBe(false);
			expect(after.can("complete", "task", overdue)).toBe(false);
			expect(before.can("complete", "task", upcoming)).toBe(true);
			expect(after.can("complete", "task", upcoming)).toBe(true);
		});
	});
});

describe("the refusals each level relies on", () => {
	const node = (field: string, op: string, value: unknown) => ({
		field,
		op,
		value,
	});
	it.each([
		[
			{ action: [] },
			"rules[0].action: expected at least one action — naming none says nothing about a request",
		],
		[
			{ action: "" },
			"rules[0].action: expected an action name — an empty one matches nothing",
		],
		[
			{ action: ["read", ""] },
			"rules[0].action: expected an action name — an empty one matches nothing",
		],
		[
			{ resource: "" },
			"rules[0].resource: expected a resource name — an empty one matches nothing",
		],
		[
			{ fields: [] },
			"rules[0].fields: expected at least one field name — naming none says nothing about a write",
		],
		[{ fields: ["name", 1] }, "rules[0].fields: expected an array of strings"],
		[
			{ fields: ["name", Symbol("name")] },
			"rules[0].fields: expected an array of strings",
		],
		[
			{ fields: [""] },
			"rules[0].fields: expected a field name — an empty key is not a field a rule can name",
		],
		[
			{ fields: ["name", ""] },
			"rules[0].fields: expected a field name — an empty key is not a field a rule can name",
		],
		[
			{ where: { and: [] } },
			"rules[0].where.and: expected at least one condition — an empty group says nothing about a row",
		],
		[
			{ where: { or: [] } },
			"rules[0].where.or: expected at least one condition — an empty group says nothing about a row",
		],
		...["false", "0", "true", "", 0, 1, [], {}, null].map((value) => [
			{ where: node("status", "exists", value) },
			'rules[0].where.value: expected a boolean for "exists"',
		]),
		[
			{ where: { field: "status", op: "exists" } },
			"rules[0].where.value: missing",
		],
		[
			{ where: node("status", "eq", undefined) },
			"rules[0].where.value: undefined is not a value a rule may compare to",
		],
		[
			{ where: node("title", "contains", 5) },
			'rules[0].where.value: expected a string for "contains"',
		],
		[
			{ where: node("title", "contains", null) },
			'rules[0].where.value: expected a string for "contains"',
		],
		[
			{ where: node("views", "gt", null) },
			'rules[0].where.value: expected a number or a string for "gt"',
		],
		[
			{ where: node("views", "gte", {}) },
			'rules[0].where.value: expected a number or a string for "gte"',
		],
		[
			{ where: node("views", "lt", true) },
			'rules[0].where.value: expected a number or a string for "lt"',
		],
		[
			{ where: node("views", "lte", [10]) },
			'rules[0].where.value: expected a number or a string for "lte"',
		],
		[
			{
				where: {
					relation: "comments",
					type: "many",
					where: node("spam", "eq", true),
				},
			},
			'rules[0].where.match: expected "some" | "every" | "none" for a to-many relation',
		],
		[
			{
				where: {
					relation: "author",
					type: "one",
					match: "some",
					where: node("role", "eq", "a"),
				},
			},
			"rules[0].where.match: a to-one relation must not carry a match",
		],
		[
			{ where: { relation: "author", type: "one" } },
			"rules[0].where.where: missing",
		],
		[
			{
				where: {
					relation: "author",
					type: "several",
					where: node("role", "eq", "a"),
				},
			},
			'rules[0].where.type: expected "one" | "many"',
		],
		[
			{ values: { or: [node("status", "eq", "d")] } },
			'rules[0].values: "or" is not allowed in values — they take a field condition or "and"',
		],
		[
			{ values: { not: node("status", "eq", "d") } },
			'rules[0].values: "not" is not allowed in values — they take a field condition or "and"',
		],
		[
			{
				values: {
					relation: "author",
					type: "one",
					where: node("id", "eq", "u1"),
				},
			},
			'rules[0].values: "relation" is not allowed in values — they take a field condition or "and"',
		],
		[
			{ values: { and: [] } },
			"rules[0].values.and: expected at least one condition — an empty group says nothing about a row",
		],
		[
			{
				values: {
					and: [node("status", "eq", "d")],
					field: "status",
					op: "eq",
					value: "x",
				},
			},
			'rules[0].values: a condition names "and" and "field" at once — a node carries exactly one shape',
		],
	] as [Record<string, unknown>, string][])("refuses %j", (extra, error) => {
		expect(
			parseRules([
				{ effect: "deny", action: "update", resource: "post", ...extra },
			]),
		).toEqual({ ok: false, errors: [error] });
	});

	it("takes exists with the two values it does take", () => {
		for (const value of [true, false]) {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: node("status", "exists", value),
					},
				]).ok,
			).toBe(true);
		}
	});
});

describe("one grammar, one dispatcher", () => {
	type Unnamed<N> = N extends unknown
		? [Extract<keyof N, (typeof CONDITION_SHAPES)[number]>] extends [never]
			? N
			: never
		: never;

	it("refuses a node naming no shape, and says which it could name", () => {
		expect(
			parseRules([
				{ effect: "allow", action: "read", resource: "post", where: {} },
			]),
		).toEqual({
			ok: false,
			errors: [
				'rules[0].where: a condition names none of "and" | "or" | "not" | "relation" | "field" — a node carries exactly one shape',
			],
		});
	});

	it("names every shape a condition node can take", () => {
		expectTypeOf<Unnamed<ConditionNode<Record<string, unknown>>>>().toBeNever();
	});

	const constrained = (constraints: unknown) => [
		{
			effect: "allow",
			action: "update",
			resource: "post",
			values: constraints,
		},
	];

	it("refuses the shapes payload constraints do not take, and says which", () => {
		for (const shape of ["or", "not", "relation"] as const) {
			const result = parseRules(
				constrained({ [shape]: { field: "status", op: "eq", value: "draft" } }),
			);

			expect(result).toEqual({
				ok: false,
				errors: [
					`rules[0].values: "${shape}" is not allowed in values — they take a field condition or "and"`,
				],
			});
		}
	});

	it("refuses a constraint naming two shapes at once", () => {
		const result = parseRules(
			constrained({
				and: [{ field: "status", op: "eq", value: "draft" }],
				field: "views",
			}),
		);

		expect(result).toEqual({
			ok: false,
			errors: [
				'rules[0].values: a condition names "and" and "field" at once — a node carries exactly one shape',
			],
		});
	});

	it("validates children inside a constraint's and, not just its own shape", () => {
		const result = parseRules(
			constrained({ and: [{ field: "status", op: "nope", value: "draft" }] }),
		);

		expect(result).toEqual({
			ok: false,
			errors: ['rules[0].values.and[0].op: unknown operator "nope"'],
		});
	});

	it("stops values that nest past the limit, and says values", () => {
		let node: Record<string, unknown> = {
			field: "status",
			op: "eq",
			value: "draft",
		};

		for (let i = 0; i < 70; i++) {
			node = { and: [node] };
		}

		const result = parseRules(constrained(node));

		expect(result.ok).toBe(false);
		expect(
			result.ok ? [] : result.errors.filter((e) => e.includes("too deep")),
		).toEqual([expect.stringContaining("values nesting too deep (max 64)")]);
	});
});

describe("a condition on the environment", () => {
	const ruleWith = (when: unknown) => [
		{ effect: "deny", action: "update", resource: "post", when },
	];

	it("is walked as a condition that reaches no relation", () => {
		expect(
			parseRules(
				ruleWith({
					and: [
						{ field: "hour", op: "gte", value: 9 },
						{ not: { or: [{ field: "region", op: "eq", value: "eu" }] } },
					],
				}),
			).ok,
		).toBe(true);
		expect(
			parseRules(
				ruleWith({
					relation: "author",
					type: "one",
					where: { field: "role", op: "eq", value: "admin" },
				}),
			),
		).toEqual({
			ok: false,
			errors: ["rules[0].when: the environment has no relations"],
		});
		expect(
			parseRules(ruleWith({ field: "hour", op: "near", value: 9 })),
		).toEqual({
			ok: false,
			errors: ['rules[0].when.op: unknown operator "near"'],
		});
	});

	it("is read only from the rule itself", () => {
		(Object.prototype as Record<string, unknown>).when = { nonsense: true };

		try {
			expect(
				parseRules([{ effect: "deny", action: "update", resource: "post" }]).ok,
			).toBe(true);
		} finally {
			delete (Object.prototype as Record<string, unknown>).when;
		}
	});
});

describe("a comparison of two fields", () => {
	const REFUSAL =
		'.ref: names another field to compare with, only in where, under "eq" | "ne" | "gt" | "gte" | "lt" | "lte", and in place of a value';
	const ruleWith = (key: string, node: unknown) => [
		{ effect: "deny", action: "update", resource: "post", [key]: node },
	];

	it("is accepted only in where, under a comparison, in place of a value", () => {
		expect(
			parseRules(ruleWith("where", { field: "a", op: "gte", ref: "b" })).ok,
		).toBe(true);

		for (const [key, node] of [
			["where", { field: "a", op: "gte", ref: "b", value: 1 }],
			["where", { field: "a", op: "contains", ref: "b" }],
			["where", { field: "a", op: "gte", ref: "" }],
			["where", { field: "a", op: "gte", ref: 7 }],
			["values", { field: "a", op: "gte", ref: "b" }],
			["when", { field: "a", op: "gte", ref: "b" }],
		] as const) {
			expect(parseRules(ruleWith(key, node))).toEqual({
				ok: false,
				errors: [`rules[0].${key}${REFUSAL}`],
			});
		}
	});
});
