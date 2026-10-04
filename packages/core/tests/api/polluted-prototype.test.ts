import { afterEach, describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import {
	ForbiddenError,
	RelationNotLoadedError,
} from "../../src/errors/index.js";
import type { CheckedRules } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Post = { id: string; authorId: string; views: number };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const mine: Post = { id: "p1", authorId: "me", views: 1 };
const yours: Post = { id: "p2", authorId: "victim", views: 1 };

const POLLUTED: [string, unknown][] = [
	["and", []],
	["or", []],
	["not", {}],
	["relation", "author"],
	["match", "some"],
	["where", {}],
	["field", "authorId"],
	["op", "eq"],
	["value", "victim"],
	["type", "one"],
	["fields", ["authorId"]],
	["constraints", {}],
	["effect", "allow"],
	["action", "read"],
	["resource", "post"],
];

const plant = <T>(planted: Record<string, unknown>, run: () => T): T => {
	const prototype = Object.prototype as Record<string, unknown>;

	Object.assign(prototype, planted);

	try {
		return run();
	} finally {
		for (const key of Object.keys(planted)) {
			delete prototype[key];
		}
	}
};

const under = <T>(key: string, value: unknown, run: () => T): T =>
	plant({ [key]: value }, run);

const forEachPollution = <T>(run: () => T): [string, T][] =>
	POLLUTED.map(([key, value]) => [key, under(key, value, run)]);

afterEach(() => {
	for (const [key] of POLLUTED) {
		delete (Object.prototype as Record<string, unknown>)[key];
	}
});

describe("a polluted prototype does not reshape a condition", () => {
	describe("an owner rule keeps refusing a foreign row", () => {
		it("refuses under every key the engine dispatches on", () => {
			const answers = forEachPollution(() =>
				buildAbility(ac, [
					allow("read", "post", { where: { authorId: "me" } }),
				]).can("read", "post", yours),
			);

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, false]));
		});

		it("still grants the row that does match", () => {
			const answers = forEachPollution(() =>
				buildAbility(ac, [
					allow("read", "post", { where: { authorId: "me" } }),
				]).can("read", "post", mine),
			);

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, true]));
		});

		it("neither throws nor recurses without end", () => {
			const outcomes = forEachPollution(() => {
				try {
					buildAbility(ac, [
						allow("read", "post", { where: { authorId: "me" } }),
					]).can("read", "post", yours);

					return "answered";
				} catch (error) {
					return `threw ${(error as Error).constructor.name}`;
				}
			});

			expect(outcomes).toEqual(POLLUTED.map(([key]) => [key, "answered"]));
		});
	});

	describe("a prohibition keeps prohibiting", () => {
		it("fires under every pollution", () => {
			const answers = forEachPollution(() =>
				buildAbility(ac, [
					allow("read", "post"),
					deny("read", "post", { where: { authorId: "victim" } }),
				]).can("read", "post", yours),
			);

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, false]));
		});

		it("keeps a payload-scoped deny scoped to the payload", () => {
			const answers = under("fields", ["authorId"], () => {
				const ability = buildAbility(ac, [
					allow("update", { post: ["views"] }),
					deny("update", { post: ["authorId"] }),
				]);

				return {
					row: ability.can("update", "post", mine),
					permitted: ability.validatePayload("update", "post", mine, {
						views: 2,
					}).ok,
					refused: ability.validatePayload("update", "post", mine, {
						authorId: "x",
					}).ok,
				};
			});

			expect(answers).toEqual({ row: true, permitted: true, refused: false });
		});

		it.each<[string, string, unknown]>([
			[
				"a condition",
				"where",
				{ field: "authorId", op: "eq", value: "victim" },
			],
			["fields", "fields", ["views"]],
			["values", "values", { field: "views", op: "eq", value: 12345 }],
		])("keeps a deny written without %s on every row", (_, key, value) => {
			const policy = () => [
				allow("update", "post", { where: { authorId: "me" } }),
				deny("update", "post"),
			];
			const where = buildAbility(ac, policy()).where("update", "post");

			const answers = under(key, value, () => {
				const ability = buildAbility(ac, policy());

				return {
					mine: ability.can("update", "post", mine),
					where: ability.where("update", "post"),
				};
			});

			expect(answers).toEqual({ mine: false, where });
		});
	});

	describe("the trust gate reads the same shapes", () => {
		const rule = (extra: Record<string, unknown>) => ({
			effect: "allow",
			action: "update",
			resource: "post",
			...extra,
		});

		const parse = (input: Record<string, unknown>) =>
			parseRules([input] as CheckedRules);

		it("accepts a sound rule and keeps its condition", () => {
			const answers = forEachPollution(() => {
				const result = parseRules([
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: "authorId", op: "eq", value: "me" },
					},
				] as CheckedRules);

				return result.ok
					? buildAbility(ac, result.rules).can("read", "post", yours)
					: "refused the rule";
			});

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, false]));
		});

		const REFUSED_IF_READ: [string, unknown][] = [
			["where", {}],
			["fields", []],
			["values", {}],
			["payload", {}],
			["match", "some"],
			["and", []],
			["or", []],
			["not", {}],
			["relation", "author"],
			["field", "authorId"],
		];

		it.each<[string, Record<string, unknown>]>([
			["an entity", {}],
			["fields", { fields: ["views"] }],
			["a row", { where: { field: "authorId", op: "eq", value: "me" } }],
			[
				"a row through a to-one relation",
				{
					where: {
						relation: "author",
						type: "one",
						where: { field: "role", op: "eq", value: "admin" },
					},
				},
			],
			[
				"a row through a to-many relation",
				{
					where: {
						relation: "comments",
						type: "many",
						match: "some",
						where: { field: "spam", op: "eq", value: true },
					},
				},
			],
			["values", { values: { field: "views", op: "lte", value: 10 } }],
			[
				"values in a group",
				{
					values: {
						and: [
							{ field: "views", op: "gte", value: 0 },
							{ field: "views", op: "lte", value: 10 },
						],
					},
				},
			],
		])("passes a sound rule on %s whatever the prototype carries", (_, extra) => {
			const answers = REFUSED_IF_READ.map(([key, value]) => [
				key,
				under(key, value, () => parse(rule(extra)).ok),
			]);

			expect(answers).toEqual(REFUSED_IF_READ.map(([key]) => [key, true]));
		});

		it.each<
			[string, Record<string, unknown>, Record<string, unknown>, string[]]
		>([
			[
				"what a rule is",
				{},
				{ effect: "allow", action: "read", resource: "post" },
				[
					'rules[0].effect: expected "allow" | "deny"',
					"rules[0].action: expected a string or an array of strings",
					"rules[0].resource: expected a string",
				],
			],
			[
				"a row condition's field and operator",
				rule({ where: { value: "victim" } }),
				{ field: "authorId", op: "eq" },
				[
					'rules[0].where: a condition names none of "and" | "or" | "not" | "relation" | "field" — a node carries exactly one shape',
				],
			],
			[
				"a row condition's operator",
				rule({ where: { field: "authorId", value: "victim" } }),
				{ op: "ne" },
				["rules[0].where.op: unknown operator undefined"],
			],
			[
				"a row condition's value",
				rule({ where: { field: "authorId", op: "eq" } }),
				{ value: "victim" },
				["rules[0].where.value: missing"],
			],
			[
				"an operator inside a row group",
				rule({ where: { and: [{ field: "authorId", value: "me" }] } }),
				{ op: "ne" },
				["rules[0].where.and[0].op: unknown operator undefined"],
			],
			[
				"a relation's cardinality",
				rule({
					where: {
						relation: "author",
						where: { field: "role", op: "eq", value: "admin" },
					},
				}),
				{ type: "one" },
				['rules[0].where.type: expected "one" | "many"'],
			],
			[
				"a to-many relation's quantifier",
				rule({
					where: {
						relation: "comments",
						type: "many",
						where: { field: "spam", op: "eq", value: true },
					},
				}),
				{ match: "some" },
				[
					'rules[0].where.match: expected "some" | "every" | "none" for a to-many relation',
				],
			],
			[
				"a relation's condition",
				rule({ where: { relation: "author", type: "one" } }),
				{ where: { field: "role", op: "ne", value: "admin" } },
				["rules[0].where.where: missing"],
			],
			[
				"a value constraint's field and operator",
				rule({ values: { value: 1 } }),
				{ field: "views", op: "eq" },
				[
					'rules[0].values: a condition names none of "and" | "or" | "not" | "relation" | "field" — a node carries exactly one shape',
				],
			],
			[
				"a value constraint's operator",
				rule({ values: { field: "views", value: 1 } }),
				{ op: "ne" },
				["rules[0].values.op: unknown operator undefined"],
			],
			[
				"a value constraint's value",
				rule({ values: { field: "views", op: "eq" } }),
				{ value: 1 },
				["rules[0].values.value: missing"],
			],
			[
				"an operator inside a value group",
				rule({ values: { and: [{ field: "views", value: 1 }] } }),
				{ op: "ne" },
				["rules[0].values.and[0].op: unknown operator undefined"],
			],
		])("refuses %s planted on the prototype", (_, input, planted, errors) => {
			expect(plant(planted, () => parse(input))).toEqual({ ok: false, errors });
		});
	});

	describe("the condition handed to a database is unchanged", () => {
		it("still carries the owner condition", () => {
			const filter = under("and", [], () =>
				JSON.stringify(
					buildAbility(ac, [
						allow("read", "post", { where: { authorId: "me" } }),
					]).where("read", "post"),
				),
			);

			expect(filter).toBe('{"field":"authorId","op":"eq","value":"me"}');
		});
	});

	describe("options planted on the prototype", () => {
		it("give a rule no condition it was written without", () => {
			const rule = under("where", { authorId: "victim" }, () =>
				deny("update", "post", { values: { views: 1 } }),
			);

			expect(Object.hasOwn(rule, "where")).toBe(false);
		});

		it("give a rule no values it was written without", () => {
			const rule = under("values", { views: 1 }, () =>
				allow("update", "post", { where: { authorId: "me" } }),
			);

			expect(Object.hasOwn(rule, "values")).toBe(false);
		});
	});

	describe("relations planted on the prototype", () => {
		it("do not turn a field of a resource without relations into one", () => {
			const where = under(
				"relations",
				{ role: { resource: "user", kind: "one" } },
				() => allow("read", "user", { where: { role: "admin" } }).where,
			);

			expect(where).toEqual({ field: "role", op: "eq", value: "admin" });
		});
	});

	describe("an empty group planted on the prototype", () => {
		it("leaves the values a rule was written with in force", () => {
			const answers = under("and", [], () => {
				const ability = buildAbility(ac, [
					allow("update", "post", { values: { views: 1 } }),
					deny("update", "post", { values: { authorId: "victim" } }),
				]);

				return [{ views: 1 }, { views: 2 }, { authorId: "victim" }].map(
					(data) => ability.validatePayload("update", "post", mine, data).ok,
				);
			});

			expect(answers).toEqual([true, false, false]);
		});
	});

	describe("a row planted on the prototype", () => {
		it("lends nothing to a deciding call made without a row", () => {
			under("row", { ...mine }, () => {
				const ability = buildAbility(ac, [
					allow("update", "post", { where: { authorId: "me" } }),
				]);

				expect(ability.canMutate("update", "post")).toBe(false);
				expect(() => ability.authorize("update", "post")).toThrow(
					ForbiddenError,
				);
			});
		});
	});

	describe("a related row planted on the prototype", () => {
		it("does not stand in for a relation the row did not load", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { author: { role: "admin" } } }),
			]);

			expect(() =>
				under("author", { id: "u1", role: "admin" }, () =>
					ability.can("read", "post", yours),
				),
			).toThrow(RelationNotLoadedError);
		});
	});

	describe("a decision hook planted on the prototype", () => {
		it("hears no decision", () => {
			const heard: unknown[] = [];

			under(
				"onDecision",
				(decision: unknown) => heard.push(decision),
				() =>
					buildAbility(ac, [allow("read", "post")], {}).can(
						"read",
						"post",
						mine,
					),
			);

			expect(heard).toEqual([]);
		});
	});

	describe("the prototype is left as it was found", () => {
		it("carries nothing after the suite", () => {
			for (const [key] of POLLUTED) {
				expect(Object.prototype).not.toHaveProperty(key);
			}
		});
	});
});
