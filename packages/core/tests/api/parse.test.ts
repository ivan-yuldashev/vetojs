import { describe, expect, expectTypeOf, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { type CONDITION_SHAPES, parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import type { ConditionNode, Rule } from "../../src/model/index.js";

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
					payload: { fields: ["title"] },
				},
			];
			const result = parseRules(input);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.rules).toEqual(input);
				expectTypeOf(result.rules).toEqualTypeOf<Rule[]>();
			}
		});

		it("accepts an empty array", () => {
			expect(parseRules([])).toEqual({ ok: true, rules: [], unknown: [] });
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
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors).toContain("rules[0]: expected a rule object");
			}
		});
	});

	describe("rule fields", () => {
		it("rejects an effect other than allow/deny", () => {
			const result = parseRules([
				{ effect: "Allow", action: "read", resource: "post" },
			]);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors).toContain(
					'rules[0].effect: expected "allow" | "deny"',
				);
			}
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
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(
					result.errors.some((error) => error.includes("unknown operator")),
				).toBe(true);
			}
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
						payload: {
							fields: ["status"],
							constraints: {
								and: [{ field: "views", op: "lt", value: 1000 }],
								field: "status",
								op: "eq",
								value: "draft",
							},
						},
					},
				]),
			).toEqual({
				ok: false,
				errors: [
					`rules[0].payload.constraints: a condition names "and" and "field" at once — a node carries exactly one shape`,
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
		it("rejects non-string payload fields", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						payload: { fields: ["title", 2] },
					},
				]).ok,
			).toBe(false);
		});

		it("rejects a payload that is not an object", () => {
			for (const payload of ["garbage", 42, null, ["fields"]]) {
				expect(
					parseRules([
						{
							effect: "allow",
							action: "update",
							resource: "post",
							payload,
						},
					]),
				).toEqual({
					ok: false,
					errors: ["rules[0].payload: expected a payload object"],
				});
			}
		});

		it("rejects a non-array and inside constraints", () => {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						payload: { constraints: { and: "garbage" } },
					},
				]),
			).toEqual({
				ok: false,
				errors: ["rules[0].payload.constraints.and: expected an array"],
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
							payload: { constraints },
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
						payload: {
							constraints: { field: "status", op: "in", value: ["draft"] },
						},
					},
				]).ok,
			).toBe(true);
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						payload: {
							constraints: {
								relation: "c",
								type: "many",
								match: "some",
								where: { field: "x", op: "eq", value: 1 },
							},
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
			expect(forNin.ok).toBe(false);
			if (!forNin.ok) {
				expect(forNin.errors).toEqual([
					'rules[0].where.value: expected an array for "nin"',
				]);
			}

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
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.errors).toHaveLength(3);
				expect(
					result.errors.every((error) => error.startsWith("rules[0].")),
				).toBe(true);
			}
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
			expect(result?.ok).toBe(false);
			if (result && !result.ok) {
				expect(result.errors.some((error) => /too deep/i.test(error))).toBe(
					true,
				);
			}
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
					payload: { constraints: node },
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

			const parsed = parseRules(JSON.parse(JSON.stringify(rules)), ac);
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

describe("one grammar, one dispatcher", () => {
	type Unnamed<N> = N extends unknown
		? [Extract<keyof N, (typeof CONDITION_SHAPES)[number]>] extends [never]
			? N
			: never
		: never;

	it("reads a node naming no shape as a field condition, and says what it lacks", () => {
		expect(
			parseRules([
				{ effect: "allow", action: "read", resource: "post", where: {} },
			]),
		).toEqual({
			ok: false,
			errors: [
				"rules[0].where.field: expected a string",
				"rules[0].where.op: unknown operator undefined",
				"rules[0].where.value: missing",
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
			payload: { constraints },
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
					`rules[0].payload.constraints: "${shape}" is not allowed in payload constraints — they take a field condition or "and"`,
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
				'rules[0].payload.constraints: a condition names "and" and "field" at once — a node carries exactly one shape',
			],
		});
	});

	it("validates children inside a constraint's and, not just its own shape", () => {
		const result = parseRules(
			constrained({ and: [{ field: "status", op: "nope", value: "draft" }] }),
		);

		expect(result).toEqual({
			ok: false,
			errors: [
				'rules[0].payload.constraints.and[0].op: unknown operator "nope"',
			],
		});
	});

	it("stops a constraint that nests past the limit, and says constraint", () => {
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
		).toEqual([
			expect.stringContaining("constraint nesting too deep (max 64)"),
		]);
	});
});
