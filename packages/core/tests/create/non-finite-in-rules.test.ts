import { describe, expect, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { parseRules } from "../../src/validate/index.js";

type User = { id: string; karma: number };
type Comment = { id: string; score: number };
type Post = {
	id: string;
	views: number;
	publishedAt: Date;
	scores: number[];
	author?: User | null;
	comments?: Comment[] | null;
};

const ac = defineAbilities({
	env: shape<{ hour: number }>(),
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: {
				author: { resource: "user", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		user: { schema: shape<User>(), actions: ["read"] },
		comment: { schema: shape<Comment>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const NON_FINITE: [name: string, value: number][] = [
	["NaN", Number.NaN],
	["Infinity", Number.POSITIVE_INFINITY],
	["-Infinity", Number.NEGATIVE_INFINITY],
];

const INVALID_DATE = new Date("not a date");

describe("a value JSON would turn into null is refused when the rule is written", () => {
	for (const [name, value] of NON_FINITE) {
		describe(name, () => {
			it("in where, as a bare value and under every operator that takes a number", () => {
				expect(() =>
					allow("read", "post", { where: { views: value } }),
				).toThrow(/views/);
				for (const operator of [
					{ eq: value },
					{ ne: value },
					{ gt: value },
					{ gte: value },
					{ lt: value },
					{ lte: value },
				]) {
					expect(() =>
						allow("read", "post", { where: { views: operator } }),
					).toThrow(/views/);
				}
				expect(() =>
					allow("read", "post", { where: { views: { in: [1, value] } } }),
				).toThrow(/views/);
				expect(() =>
					deny("read", "post", { where: { views: { nin: [value] } } }),
				).toThrow(/views/);
			});

			it("in where, as an element of an array field", () => {
				expect(() =>
					allow("read", "post", { where: { scores: { has: value } } }),
				).toThrow(/scores/);
				expect(() =>
					allow("read", "post", { where: { scores: { hasAny: [value] } } }),
				).toThrow(/scores/);
				expect(() =>
					deny("read", "post", { where: { scores: { hasAll: [1, value] } } }),
				).toThrow(/scores/);
			});

			it("in where, under and, or and not", () => {
				expect(() =>
					allow("read", "post", { where: { and: [{ views: value }] } }),
				).toThrow(/views/);
				expect(() =>
					allow("read", "post", { where: { or: [{ views: value }] } }),
				).toThrow(/views/);
				expect(() =>
					deny("read", "post", { where: { not: { views: value } } }),
				).toThrow(/views/);
			});

			it("in where, through a relation", () => {
				expect(() =>
					allow("read", "post", { where: { author: { karma: value } } }),
				).toThrow(/karma/);
				expect(() =>
					deny("read", "post", {
						where: { comments: { some: { score: { gt: value } } } },
					}),
				).toThrow(/score/);
			});

			it("in values", () => {
				expect(() =>
					allow("update", { post: ["views"] }, { values: { views: value } }),
				).toThrow(/views/);
				expect(() =>
					deny("update", "post", { values: { views: { in: [value] } } }),
				).toThrow(/views/);
			});

			it("in when", () => {
				expect(() => allow("read", "post", { when: { hour: value } })).toThrow(
					/hour/,
				);
				expect(() =>
					deny("read", "post", { when: { hour: { gte: value } } }),
				).toThrow(/hour/);
			});
		});
	}

	describe("an invalid Date", () => {
		it("in where, values and when alike", () => {
			expect(() =>
				allow("read", "post", { where: { publishedAt: INVALID_DATE } }),
			).toThrow(/publishedAt/);
			expect(() =>
				deny("read", "post", { where: { publishedAt: { lt: INVALID_DATE } } }),
			).toThrow(/publishedAt/);
			expect(() =>
				allow("read", "post", {
					where: { publishedAt: { in: [INVALID_DATE] } },
				}),
			).toThrow(/publishedAt/);
			expect(() =>
				allow(
					"update",
					{ post: ["publishedAt"] },
					{ values: { publishedAt: INVALID_DATE } },
				),
			).toThrow(/publishedAt/);
		});
	});

	it("keeps the finite numbers and valid dates a rule may carry", () => {
		expect(allow("read", "post", { where: { views: 0 } }).where).toEqual({
			field: "views",
			op: "eq",
			value: 0,
		});
		expect(
			allow("read", "post", { where: { views: { lt: Number.MAX_VALUE } } })
				.where,
		).toEqual({ field: "views", op: "lt", value: Number.MAX_VALUE });
		expect(
			allow("read", "post", { where: { publishedAt: new Date(0) } }).where,
		).toEqual({ field: "publishedAt", op: "eq", value: 0 });
	});
});

describe("a value JSON cannot carry is refused when a rule arrives from outside", () => {
	const refused = (rule: Record<string, unknown>) => {
		const result = parseRules([
			{ effect: "allow", action: "read", resource: "post", ...rule },
		]);

		return result.ok ? "accepted" : result.errors.join("; ");
	};

	for (const [name, value] of NON_FINITE) {
		it(`${name} in where, values and when, as a value or a list member`, () => {
			for (const op of ["eq", "ne", "gt", "gte", "lt", "lte", "has"]) {
				expect(refused({ where: { field: "views", op, value } })).toContain(
					"rules[0].where",
				);
			}
			for (const op of ["in", "nin", "hasAny", "hasAll"]) {
				expect(
					refused({ where: { field: "views", op, value: [1, value] } }),
				).toContain("rules[0].where");
			}
			expect(
				refused({
					where: {
						relation: "author",
						type: "one",
						where: { field: "karma", op: "eq", value },
					},
				}),
			).toContain("rules[0].where");
			expect(
				refused({ where: { and: [{ field: "views", op: "eq", value }] } }),
			).toContain("rules[0].where");
			expect(
				refused({
					fields: ["views"],
					values: { field: "views", op: "eq", value },
				}),
			).toContain("rules[0].values");
			expect(refused({ when: { field: "hour", op: "gte", value } })).toContain(
				"rules[0].when",
			);
		});
	}

	it("keeps null, which JSON carries and a rule may compare with", () => {
		expect(refused({ where: { field: "views", op: "eq", value: null } })).toBe(
			"accepted",
		);
		expect(
			refused({ where: { field: "views", op: "in", value: [1, null] } }),
		).toBe("accepted");
		expect(
			refused({
				fields: ["views"],
				values: { field: "views", op: "ne", value: null },
			}),
		).toBe("accepted");
		expect(refused({ when: { field: "hour", op: "eq", value: null } })).toBe(
			"accepted",
		);
	});
});
