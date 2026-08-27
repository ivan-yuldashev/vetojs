import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import { toVocabulary, type Vocabulary } from "../../src/api/vocabulary.js";
import type { Rule } from "../../src/model/index.js";

type Post = { id: string; status: "draft" | "published" };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: {
				author: { resource: "user", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		user: {
			schema: shape<{ id: string; role: string }>(),
			actions: ["read"],
			relations: { manager: { resource: "user", kind: "one" } },
		},
		comment: {
			schema: shape<{ id: string; spam: boolean }>(),
			actions: ["read"],
		},
	},
});

const rule = (partial: Partial<Rule> & Pick<Rule, "effect">): Rule => ({
	action: "read",
	resource: "post",
	...partial,
});

describe("toVocabulary", () => {
	it("strips schemas and survives a JSON round-trip", () => {
		const vocabulary = toVocabulary(ac);
		expect(JSON.parse(JSON.stringify(vocabulary))).toEqual(vocabulary);
		expect(vocabulary.post?.actions).toEqual(["read", "update"]);
		expect(vocabulary.post?.relations?.author).toEqual({
			resource: "user",
			kind: "one",
		});
		expect("schema" in (vocabulary.post ?? {})).toBe(false);
	});
});

describe("parseRules — the vocabulary gate", () => {
	it("accepts ac directly as the vocabulary", () => {
		const result = parseRules([rule({ effect: "allow" })], ac);
		expect(result).toEqual({
			ok: true,
			rules: [rule({ effect: "allow" })],
			unknown: [],
		});
	});

	it("without a vocabulary keeps prior behavior (shape only, unknown empty)", () => {
		const dirty = [rule({ effect: "allow", resource: "psot" })];
		expect(parseRules(dirty)).toEqual({ ok: true, rules: dirty, unknown: [] });
	});

	it("quarantines an allow with an unknown resource", () => {
		const result = parseRules(
			[rule({ effect: "allow", resource: "psot" })],
			ac,
		);
		expect(result.ok && result.rules).toEqual([]);
		expect(result.ok && result.unknown).toEqual([
			{
				rule: rule({ effect: "allow", resource: "psot" }),
				reasons: ['rules[0].resource: unknown resource "psot"'],
				quarantined: true,
			},
		]);
	});

	it("quarantines an allow with an unknown action (mixed array too)", () => {
		const result = parseRules(
			[rule({ effect: "allow", action: ["read", "explode"] })],
			ac,
		);
		expect(result.ok && result.rules).toEqual([]);
		expect(result.ok && result.unknown[0]?.reasons).toEqual([
			'rules[0].action: unknown action "explode" for resource "post"',
		]);
	});

	it("keeps an unknown deny in the engine and reports it", () => {
		const deny = rule({ effect: "deny", action: ["read", "explode"] });
		const result = parseRules([deny], ac);
		expect(result.ok && result.rules).toEqual([deny]);
		expect(result.ok && result.unknown).toEqual([
			{
				rule: deny,
				reasons: [
					'rules[0].action: unknown action "explode" for resource "post"',
				],
				quarantined: false,
			},
		]);
	});

	it('treats "manage" as always known', () => {
		const result = parseRules(
			[rule({ effect: "allow", action: "manage" })],
			ac,
		);
		expect(result.ok && result.unknown).toEqual([]);
	});

	it("walks relations in where, including nested targets", () => {
		const where: Rule["where"] = {
			relation: "author",
			type: "one",
			where: {
				relation: "manager",
				type: "one",
				where: { field: "role", op: "eq", value: "admin" },
			},
		};
		const okResult = parseRules([rule({ effect: "allow", where })], ac);
		expect(okResult.ok && okResult.unknown).toEqual([]);

		const badWhere: Rule["where"] = {
			relation: "author",
			type: "one",
			where: {
				relation: "team",
				type: "one",
				where: { field: "id", op: "eq", value: "t1" },
			},
		};
		const badResult = parseRules(
			[rule({ effect: "allow", where: badWhere })],
			ac,
		);
		expect(badResult.ok && badResult.unknown[0]?.reasons).toEqual([
			'rules[0].where.where: unknown relation "team" on resource "user"',
		]);
	});

	it("flags a relation kind mismatch", () => {
		const where: Rule["where"] = {
			relation: "comments",
			type: "one",
			where: { field: "spam", op: "eq", value: true },
		};
		const result = parseRules([rule({ effect: "allow", where })], ac);
		expect(result.ok && result.unknown[0]?.reasons).toEqual([
			'rules[0].where: relation "comments" is "many", the rule says "one"',
		]);
	});

	it("walks into and / or / not to find an unknown relation", () => {
		const unknownRelation: NonNullable<Rule["where"]> = {
			relation: "series",
			type: "many",
			match: "some",
			where: { field: "banned", op: "eq", value: true },
		};

		const nested: [NonNullable<Rule["where"]>, string][] = [
			[
				{ and: [{ field: "id", op: "eq", value: "1" }, unknownRelation] },
				"rules[0].where.and[1]",
			],
			[{ or: [unknownRelation] }, "rules[0].where.or[0]"],
			[{ not: unknownRelation }, "rules[0].where.not"],
		];

		for (const [where, path] of nested) {
			const result = parseRules([rule({ effect: "allow", where })], ac);
			expect(result.ok && result.unknown[0]?.reasons).toEqual([
				`${path}: unknown relation "series" on resource "post"`,
			]);
			expect(result.ok && result.rules).toEqual([]);
		}
	});

	it("flags a relation whose target resource is missing from the vocabulary", () => {
		const dangling: Vocabulary = {
			post: {
				actions: ["read"],
				relations: { ghost: { resource: "ghost", kind: "one" } },
			},
		};
		const result = parseRules(
			[
				rule({
					effect: "allow",
					where: {
						relation: "ghost",
						type: "one",
						where: { field: "id", op: "eq", value: "1" },
					},
				}),
			],
			dangling,
		);

		expect(result.ok && result.unknown[0]?.reasons).toEqual([
			'rules[0].where: relation "ghost" targets unknown resource "ghost"',
		]);
	});

	it("keeps a deny with an unknown relation in its where", () => {
		const deny = rule({
			effect: "deny",
			where: {
				relation: "series",
				type: "many",
				match: "some",
				where: { field: "banned", op: "eq", value: true },
			},
		});
		const result = parseRules([deny], ac);
		expect(result.ok && result.rules).toEqual([deny]);
		expect(result.ok && result.unknown[0]).toMatchObject({
			quarantined: false,
		});
	});
});

describe("the vocabulary gate — monotonicity (gated ⊆ ungated)", () => {
	const statuses = ["draft", "published"] as const;
	const mixedRules: Rule[] = (["allow", "deny"] as const).flatMap((effect) =>
		["post", "psot"].flatMap((resource) =>
			["read", "explode"].flatMap((action) => [
				{ effect, action, resource },
				{
					effect,
					action,
					resource,
					where: { field: "status", op: "eq", value: "draft" },
				},
			]),
		),
	);

	const ruleSets: Rule[][] = [
		mixedRules,
		mixedRules.filter((candidate) => candidate.effect === "allow"),
		mixedRules.filter((candidate) => candidate.effect === "deny"),
		...mixedRules.map((single) => [single]),
	];

	it("never grants what the ungated ability denies", () => {
		for (const rules of ruleSets) {
			const parsed = parseRules(rules, ac);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) {
				continue;
			}

			const gated = buildAbility(ac, parsed.rules);
			const ungated = buildAbility(ac, rules as CheckedRules);

			for (const resource of ["post", "psot"] as const) {
				for (const action of ["read", "explode"] as const) {
					for (const status of statuses) {
						const instance = { id: "p1", status } as never;
						const can = (ability: typeof gated) =>
							ability.can(action as never, resource as never, instance);
						if (can(gated)) {
							expect(can(ungated)).toBe(true);
						}
					}
				}
			}
		}
	});
});
