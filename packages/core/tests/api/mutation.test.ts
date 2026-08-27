import { describe, expect, it } from "vitest";
import {
	canMutate,
	permittedFields,
	validatePayload,
} from "../../src/api/mutation.js";
import type { Rule } from "../../src/model/index.js";
import {
	CONDITION_OPERATORS,
	type ConditionOperator,
} from "../../src/shared/constants/operators.js";

type Post = {
	authorId: string;
	status: "draft" | "published";
	title: string;
	featured: boolean;
	views: number;
};

const row: Post = {
	authorId: "u1",
	status: "draft",
	title: "hello",
	featured: false,
	views: 0,
};

describe("canMutate", () => {
	it("is true when an allow's where holds for the row", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
			},
		];
		expect(canMutate(rules, "update", "post", row)).toBe(true);
		expect(canMutate(rules, "update", "post", { ...row, authorId: "u2" })).toBe(
			false,
		);
	});

	it("respects deny-override", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{ effect: "deny", action: "update", resource: "post" },
		];
		expect(canMutate(rules, "update", "post", row)).toBe(false);
	});

	it("denies by default when no rules apply", () => {
		expect(canMutate([], "update", "post", row)).toBe(false);
	});
});

describe("validatePayload — fields", () => {
	it("permits any field when no allow restricts fields", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
		];
		expect(
			validatePayload(rules, "update", "post", row, {
				title: "new",
				status: "published",
			}),
		).toEqual({ ok: true, data: { title: "new", status: "published" } });
	});

	it("one unrestricted allow opens every field, whatever the narrow ones list", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{ effect: "allow", action: "update", resource: "post" },
		];

		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }),
		).toEqual({ ok: true, data: { status: "published" } });
		expect(
			permittedFields(rules, "update", "post", ["title", "status"]),
		).toEqual(["title", "status"]);
	});

	it("rejects a field outside the allow set", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title", "status"] },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, { title: "new" }),
		).toEqual({ ok: true, data: { title: "new" } });
		expect(
			validatePayload(rules, "update", "post", row, { featured: true }),
		).toEqual({
			ok: false,
			violations: [{ field: "featured", reason: "field not permitted" }],
		});
	});

	it("subtracts deny fields from the allow set", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title", "status"] },
			},
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: { fields: ["status"] },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, { title: "new" }),
		).toEqual({ ok: true, data: { title: "new" } });
		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "field not permitted" }],
		});
	});

	it("subtracts deny fields even when no allow restricts fields", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: { fields: ["featured"] },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, { featured: true }),
		).toEqual({
			ok: false,
			violations: [{ field: "featured", reason: "field not permitted" }],
		});
		expect(
			validatePayload(rules, "update", "post", row, { title: "ok" }),
		).toEqual({ ok: true, data: { title: "ok" } });
	});

	it("collects a violation per offending field", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, {
				status: "published",
				featured: true,
			}),
		).toEqual({
			ok: false,
			violations: [
				{ field: "status", reason: "field not permitted" },
				{ field: "featured", reason: "field not permitted" },
			],
		});
	});

	it("ignores rules whose where does not hold for the row", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u1" },
				payload: { fields: ["title"] },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "field not permitted" }],
		});
	});

	it("always permits an empty payload", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
		];
		expect(validatePayload(rules, "update", "post", row, {})).toEqual({
			ok: true,
			data: {},
		});
	});

	it("returns a copy of data on success, not the same reference", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
		];
		const data = { title: "new" };
		const result = validatePayload(rules, "update", "post", row, data);
		expect(result).toEqual({ ok: true, data: { title: "new" } });
		if (result.ok) {
			expect(result.data).not.toBe(data);
		}
	});
});

describe("validatePayload — rule intersections & complex constraints", () => {
	it("a constrained field is not freed by an allow that names other fields", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					fields: ["status"],
					constraints: { field: "status", op: "in", value: ["draft"] },
				},
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});

		expect(
			validatePayload(rules, "update", "post", row, { status: "draft" }).ok,
		).toBe(true);
	});

	it("a constraint whose field is not a string is unreadable, so it grants nothing", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					fields: ["status"],
					constraints: {
						field: 42,
						op: "eq",
						value: "published",
					} as unknown as Rule<Post>["payload"] extends infer P
						? P extends { constraints?: infer C }
							? C
							: never
						: never,
				},
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }).ok,
		).toBe(false);
	});

	it("allows values when multiple rules permit different values for the same field (Logical OR across rules)", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					constraints: { field: "status", op: "eq", value: "published" },
				},
			},
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { constraints: { field: "status", op: "eq", value: "draft" } },
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }),
		).toEqual({ ok: true, data: { status: "published" } });
		expect(
			validatePayload(rules, "update", "post", row, { status: "draft" }),
		).toEqual({ ok: true, data: { status: "draft" } });

		expect(
			validatePayload(rules, "update", "post", row, {
				status: "archived",
			}),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});
	});

	it("strictly enforces ALL conditions within a single rule's 'and' constraint (Logical AND within rule)", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					constraints: {
						and: [
							{ field: "views", op: "gt", value: 5 },
							{ field: "views", op: "lt", value: 10 },
						],
					},
				},
			},
		];

		expect(validatePayload(rules, "update", "post", row, { views: 7 })).toEqual(
			{ ok: true, data: { views: 7 } },
		);

		expect(
			validatePayload(rules, "update", "post", row, { views: 15 }),
		).toEqual({
			ok: false,
			violations: [{ field: "views", reason: "value not permitted" }],
		});
	});

	it("triggers deny only if all conditions for the field in a deny rule are met", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: {
					constraints: {
						and: [
							{ field: "views", op: "gt", value: 5 },
							{ field: "views", op: "lt", value: 10 },
						],
					},
				},
			},
		];

		expect(validatePayload(rules, "update", "post", row, { views: 7 })).toEqual(
			{
				ok: false,
				violations: [{ field: "views", reason: "value denied" }],
			},
		);

		expect(
			validatePayload(rules, "update", "post", row, { views: 15 }),
		).toEqual({
			ok: true,
			data: { views: 15 },
		});
	});

	it("unions allowed fields from multiple rules", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["status"] },
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, {
				title: "new",
				status: "published",
			}),
		).toEqual({
			ok: true,
			data: { title: "new", status: "published" },
		});

		expect(
			validatePayload(rules, "update", "post", row, { featured: true }),
		).toEqual({
			ok: false,
			violations: [{ field: "featured", reason: "field not permitted" }],
		});
	});

	it("applies value constraints even if rule does not restrict fields array", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					constraints: { field: "status", op: "eq", value: "published" },
				},
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, {
				status: "published",
				title: "any title",
			}),
		).toEqual({
			ok: true,
			data: { status: "published", title: "any title" },
		});

		expect(
			validatePayload(rules, "update", "post", row, { status: "draft" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});
	});

	it("ignores constraints of a rule if the field is excluded by the rule's fields array", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					fields: ["title"],
					constraints: { field: "status", op: "eq", value: "published" },
				},
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, { status: "published" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "field not permitted" }],
		});
	});

	it("evaluates complex logical operators (or, not) in the rule's where condition", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				where: {
					or: [
						{ field: "authorId", op: "eq", value: "u1" },
						{
							and: [
								{ field: "status", op: "eq", value: "published" },
								{ not: { field: "views", op: "lt", value: 100 } },
							],
						},
					],
				},
			},
		];

		expect(canMutate(rules, "update", "post", row)).toBe(true);

		expect(
			canMutate(rules, "update", "post", {
				...row,
				authorId: "u2",
				status: "published",
				views: 500,
			}),
		).toBe(true);

		expect(
			canMutate(rules, "update", "post", {
				...row,
				authorId: "u2",
				status: "published",
				views: 50,
			}),
		).toBe(false);
	});

	it("rejects or / not in payload constraints at compile time, and fails closed at runtime", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: {
					constraints: {
						// @ts-expect-error or is not allowed in payload.constraints (field / and only)
						or: [
							{ field: "status", op: "eq", value: "draft" },
							{ field: "views", op: "gt", value: 100 },
						],
					},
				},
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, { status: "draft" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});
	});

	it("fails closed in both directions on an unreadable constraint node", () => {
		const unreadable = {
			relation: "author",
			type: "one",
			where: { field: "id", op: "eq", value: "u1" },
		} as never;

		const allowRules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { constraints: unreadable },
			},
		];

		expect(
			validatePayload(allowRules, "update", "post", row, { status: "draft" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});

		const denyRules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: { constraints: unreadable },
			},
		];

		expect(
			validatePayload(denyRules, "update", "post", row, { status: "draft" }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value denied" }],
		});
	});

	it("fails closed when the unreadable node is nested inside an and", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: {
					constraints: {
						and: [
							{ field: "status", op: "eq", value: "draft" },
							{
								relation: "author",
								type: "one",
								where: { field: "id", op: "eq", value: "u1" },
							},
						],
					} as never,
				},
			},
		];

		expect(
			validatePayload(rules, "update", "post", row, { title: "hello" }),
		).toEqual({
			ok: false,
			violations: [{ field: "title", reason: "value denied" }],
		});
	});
});

describe("validatePayload — row-level & blanket deny veto (V2)", () => {
	it("vetoes the whole mutation when a row-level deny holds for the row", () => {
		const locked: Post = { ...row, status: "published" };
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{
				effect: "deny",
				action: "update",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
		];
		expect(
			validatePayload(rules, "update", "post", locked, { title: "x" }),
		).toEqual({ ok: false, violations: [] });
	});

	it("vetoes under an unconditional deny", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{ effect: "deny", action: "update", resource: "post" },
		];
		expect(
			validatePayload(rules, "update", "post", row, { title: "x" }),
		).toEqual({ ok: false, violations: [] });
	});

	it("does not veto when the row-level deny's where does not hold", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{
				effect: "deny",
				action: "update",
				resource: "post",
				where: { field: "status", op: "eq", value: "published" },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, { title: "x" }),
		).toEqual({ ok: true, data: { title: "x" } });
	});

	it("keeps a field-level deny as field subtraction, not a global veto", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: { fields: ["featured"] },
			},
		];
		expect(
			validatePayload(rules, "update", "post", row, { title: "ok" }),
		).toEqual({ ok: true, data: { title: "ok" } });
	});
});

describe("validatePayload — invalid input (Zone 3 Fail-Closed)", () => {
	const rules: Rule<Post>[] = [
		{
			effect: "allow",
			action: "update",
			resource: "post",
			payload: { fields: ["title"] },
		},
	];

	it("denies without throwing when the row is not a plain object", () => {
		const call = () =>
			validatePayload(rules, "update", "post", null, { title: "x" });
		expect(call).not.toThrow();
		expect(call()).toEqual({ ok: false, violations: [] });
	});

	it("denies when the data is not a plain object", () => {
		expect(validatePayload(rules, "update", "post", row, null)).toEqual({
			ok: false,
			violations: [],
		});
	});
});

describe("permittedFields", () => {
	it("one unrestricted allow opens every field, whatever the narrow ones list", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{ effect: "allow", action: "update", resource: "post" },
		];

		expect(
			permittedFields(rules, "update", "post", ["title", "status", "views"]),
		).toEqual(["title", "status", "views"]);
	});

	it("returns explicitly allowed fields intersected with the universe", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title", "status"] },
			},
		];
		expect(
			permittedFields(rules, "update", "post", ["title", "status", "authorId"]),
		).toEqual(["title", "status"]);
	});

	it("returns the whole universe when an allow grants all fields", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
		];
		expect(
			permittedFields(rules, "update", "post", ["title", "views"]),
		).toEqual(["title", "views"]);
	});

	it("subtracts deny payload.fields", () => {
		const rules: Rule<Post>[] = [
			{ effect: "allow", action: "update", resource: "post" },
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: { fields: ["views"] },
			},
		];
		expect(
			permittedFields(rules, "update", "post", ["title", "views"]),
		).toEqual(["title"]);
	});

	it("returns nothing when no allow matches the action", () => {
		expect(permittedFields([], "update", "post", ["title"])).toEqual([]);
	});

	it("returns nothing under a blanket deny", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title"] },
			},
			{ effect: "deny", action: "update", resource: "post" },
		];
		expect(permittedFields(rules, "update", "post", ["title"])).toEqual([]);
	});

	it("does not treat a constraints-only deny as a blanket field deny", () => {
		const rules: Rule<Post>[] = [
			{
				effect: "allow",
				action: "update",
				resource: "post",
				payload: { fields: ["title", "status"] },
			},
			{
				effect: "deny",
				action: "update",
				resource: "post",
				payload: {
					constraints: { field: "status", op: "eq", value: "archived" },
				},
			},
		];
		expect(
			permittedFields(rules, "update", "post", ["title", "status", "featured"]),
		).toEqual(["title", "status"]);
	});
});

type Probe = {
	op: ConditionOperator;
	value: unknown;
	match: unknown;
	miss: unknown;
};

const probes: Probe[] = [
	{ op: "eq", value: "published", match: "published", miss: "draft" },
	{ op: "ne", value: "published", match: "draft", miss: "published" },
	{ op: "in", value: ["a", "b"], match: "a", miss: "z" },
	{ op: "nin", value: ["a", "b"], match: "z", miss: "a" },
	{ op: "gt", value: 1000, match: 5000, miss: 10 },
	{ op: "gte", value: 1000, match: 1000, miss: 10 },
	{ op: "lt", value: 1000, match: 10, miss: 5000 },
	{ op: "lte", value: 1000, match: 1000, miss: 5000 },
	{ op: "contains", value: "secret", match: "top secret", miss: "public" },
	{ op: "exists", value: true, match: "anything", miss: null },
	{ op: "has", value: "x", match: ["x", "y"], miss: ["y"] },
	{ op: "hasAny", value: ["x", "z"], match: ["x", "y"], miss: ["y"] },
	{ op: "hasAll", value: ["x", "y"], match: ["x", "y", "z"], miss: ["x"] },
];

describe("validatePayload — every operator, over sound and broken values", () => {
	const allowValue = (probe: Probe): Rule[] => [
		{
			effect: "allow",
			action: "update",
			resource: "post",
			payload: {
				fields: ["value"],
				constraints: { field: "value", op: probe.op, value: probe.value },
			},
		},
	];

	const denyValue = (probe: Probe): Rule[] => [
		{ effect: "allow", action: "update", resource: "post" },
		{
			effect: "deny",
			action: "update",
			resource: "post",
			payload: {
				constraints: { field: "value", op: probe.op, value: probe.value },
			},
		},
	];

	const write = (rules: Rule[], value: unknown) =>
		validatePayload(rules, "update", "post", { id: "p" }, { value }).ok;

	const wrappings = [
		{ name: "array-wrapped", wrap: (value: unknown) => [value] },
		{ name: "object-wrapped", wrap: (value: unknown) => ({ value }) },
	];

	it("covers every operator exactly once", () => {
		expect(probes.map((probe) => probe.op).sort()).toEqual(
			[...CONDITION_OPERATORS].sort(),
		);
	});

	for (const probe of probes) {
		it(`${probe.op}: permits the matching value and refuses the missing one`, () => {
			expect(write(allowValue(probe), probe.match)).toBe(true);
			expect(write(allowValue(probe), probe.miss)).toBe(false);
			expect(write(denyValue(probe), probe.match)).toBe(false);
			expect(write(denyValue(probe), probe.miss)).toBe(true);
		});

		for (const { name, wrap } of wrappings) {
			it(`${probe.op}: a ${name} value never slips past the gate`, () => {
				expect(write(denyValue(probe), wrap(probe.match))).toBe(false);

				if (probe.op !== "exists") {
					expect(write(allowValue(probe), wrap(probe.match))).toBe(false);
				}
			});
		}
	}
});
