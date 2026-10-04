import { describe, expect, expectTypeOf, it } from "vitest";
import type { Ability, AbilityForEnv } from "../../src/api/index.js";
import { buildAbility, withEnv } from "../../src/api/index.js";
import { compileMatcher } from "../../src/compile/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import {
	ForbiddenError,
	RelationNotLoadedError,
} from "../../src/errors/index.js";
import type { CheckedRule, CheckedRules } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Author = { id: string; role: string };
type Post = {
	id: string;
	authorId: string;
	status: string;
	title: string;
	views: number;
	author?: Author | null | undefined;
};
type Env = { hour: number; region: string; mfa: boolean };

const resources = {
	post: {
		schema: shape<Post>(),
		actions: ["read", "update", "delete"],
		relations: { author: { resource: "user", kind: "one" } },
	},
	user: { schema: shape<Author>(), actions: ["read"] },
} as const;

const ac = defineAbilities({ env: shape<Env>(), resources });
const plainAc = defineAbilities({ resources });

const { allow, deny } = createRules(ac);

const mine: Post = {
	id: "p1",
	authorId: "u1",
	status: "draft",
	title: "a",
	views: 1,
	author: { id: "u1", role: "admin" },
};
const theirs: Post = { ...mine, id: "p2", authorId: "u2" };

const EU = { region: "eu" } as const;
const IN_EU: Env = { hour: 10, region: "eu", mfa: true };
const IN_US: Env = { hour: 10, region: "us", mfa: true };
const NOWHERE = { hour: 10, mfa: true } as unknown as Env;

const fromOutside = (json: unknown): CheckedRules => {
	const parsed = parseRules(json);

	if (!parsed.ok) {
		throw new Error(parsed.errors.join("\n"));
	}

	return parsed.rules;
};

const unboundAsAbility = (rules: CheckedRule[]) =>
	buildAbility(ac, rules) as unknown as Ability<typeof ac>;

const selects = (
	ability: Ability<typeof ac>,
	action: "read" | "update",
	row: Post,
) => compileMatcher(ability.where(action, "post"))(row) === true;

describe("whether a rule takes part", () => {
	const table: [effect: "allow" | "deny", env: string, takesPart: boolean][] = [
		["allow", "meets its when", true],
		["allow", "fails its when", false],
		["allow", "lacks the key its when reads", false],
		["deny", "meets its when", true],
		["deny", "fails its when", false],
		["deny", "lacks the key its when reads", true],
	];
	const ENVS: Record<string, Env> = {
		"meets its when": IN_EU,
		"fails its when": IN_US,
		"lacks the key its when reads": NOWHERE,
	};

	it.each(
		table,
	)("an %s in an environment that %s takes part: %s", (effect, env, takesPart) => {
		const rules =
			effect === "allow"
				? [allow("read", "post", { when: EU })]
				: [allow("read", "post"), deny("read", "post", { when: EU })];
		const ability = withEnv(buildAbility(ac, rules), ENVS[env] as Env);
		const isOpen = effect === "allow" ? takesPart : !takesPart;

		expect(ability.can("read", "post", mine)).toBe(isOpen);
		expect(selects(ability, "read", mine)).toBe(isOpen);
		expect(ability.canMutate("read", "post", mine)).toBe(isOpen);
	});

	it("leaves the rules without when alone in every environment", () => {
		for (const env of [IN_EU, IN_US, NOWHERE]) {
			const ability = withEnv(
				buildAbility(ac, [
					allow("read", "post", { where: { authorId: "u1" } }),
					deny("read", "post", { where: { status: "archived" } }),
				]),
				env,
			);

			expect(ability.can("read", "post", mine)).toBe(true);
			expect(ability.can("read", "post", theirs)).toBe(false);
			expect(ability.can("read", "post", { ...mine, status: "archived" })).toBe(
				false,
			);
		}
	});
});

describe("a condition on the environment", () => {
	it("combines three-valued, so a lacking key decides only where nothing else does", () => {
		const cases: [
			when: Parameters<typeof allow>[2],
			env: Env,
			allowTakesPart: boolean,
			denyStands: boolean,
		][] = [
			[
				{ when: { or: [{ hour: { gte: 9 } }, EU] } },
				{ hour: 10, mfa: true } as unknown as Env,
				true,
				true,
			],
			[
				{ when: { or: [{ hour: { gte: 12 } }, EU] } },
				{ hour: 10, mfa: true } as unknown as Env,
				false,
				true,
			],
			[
				{ when: { and: [{ hour: { gte: 12 } }, EU] } },
				{ hour: 10, mfa: true } as unknown as Env,
				false,
				false,
			],
			[
				{ when: { and: [{ hour: { gte: 9 } }, EU] } },
				{ hour: 10, mfa: true } as unknown as Env,
				false,
				true,
			],
			[{ when: { not: EU } }, NOWHERE, false, true],
			[{ when: { not: EU } }, IN_US, true, true],
			[{ when: { not: EU } }, IN_EU, false, false],
		];

		for (const [options, env, allowTakesPart, denyStands] of cases) {
			const permission = withEnv(
				buildAbility(ac, [allow("read", "post", options)]),
				env,
			);
			const prohibition = withEnv(
				buildAbility(ac, [
					allow("read", "post"),
					deny("read", "post", options),
				]),
				env,
			);

			expect({
				options,
				env,
				granted: permission.can("read", "post", mine),
			}).toEqual({
				options,
				env,
				granted: allowTakesPart,
			});
			expect({
				options,
				env,
				left: prohibition.can("read", "post", mine),
			}).toEqual({
				options,
				env,
				left: !denyStands,
			});
		}
	});

	it("is read as an environment without keys when what is bound is not a plain object", () => {
		class Session {
			region = "eu";
		}

		for (const env of [
			null,
			undefined,
			"eu",
			7,
			["eu"],
			new Date(),
			new Session(),
		]) {
			const permission = withEnv(
				buildAbility(ac, [allow("read", "post", { when: EU })]),
				env as unknown as Env,
			);
			const prohibition = withEnv(
				buildAbility(ac, [
					allow("read", "post"),
					deny("read", "post", { when: EU }),
				]),
				env as unknown as Env,
			);

			expect(permission.can("read", "post", mine)).toBe(false);
			expect(prohibition.can("read", "post", mine)).toBe(false);
		}
	});

	it("reads only the keys the environment owns", () => {
		const inherited = Object.create({ region: "eu" }) as Env;

		expect(
			withEnv(
				buildAbility(ac, [allow("read", "post", { when: EU })]),
				inherited,
			).can("read", "post", mine),
		).toBe(false);
		expect(
			withEnv(
				buildAbility(ac, [
					allow("read", "post"),
					deny("read", "post", { when: { region: { ne: "eu" } } }),
				]),
				inherited,
			).can("read", "post", mine),
		).toBe(false);
	});
});

describe("without a binding", () => {
	it("grants nothing by an allow with when, and lets every deny with when stand", () => {
		const permission = unboundAsAbility([allow("read", "post", { when: EU })]);
		const prohibition = unboundAsAbility([
			allow("read", "post"),
			deny("read", "post", { when: EU }),
		]);

		for (const row of [mine, undefined]) {
			expect(permission.can("read", "post", row)).toBe(false);
			expect(prohibition.can("read", "post", row)).toBe(false);
			expect(prohibition.canMutate("read", "post", row)).toBe(false);
		}

		expect(selects(permission, "read", mine)).toBe(false);
		expect(selects(prohibition, "read", mine)).toBe(false);
	});

	it("holds the same in an app that declares no environment", () => {
		const ability = buildAbility(
			plainAc,
			fromOutside([
				{
					effect: "allow",
					action: "read",
					resource: "post",
					when: { field: "region", op: "eq", value: "eu" },
				},
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					when: { field: "region", op: "eq", value: "eu" },
				},
			]),
		);

		expect(ability.can("read", "post", mine)).toBe(false);
		expect(ability.can("update", "post", mine)).toBe(false);
		expect(JSON.stringify(ability.where("read", "post"))).toBe('{"or":[]}');
	});

	it("does not ask for a relation only an allow with when reads", () => {
		const ability = unboundAsAbility([
			allow("read", "post", { where: { status: "draft" } }),
			allow("read", "post", { where: { author: { role: "admin" } }, when: EU }),
		]);

		expect(ability.can("read", "post", { ...mine, author: undefined })).toBe(
			true,
		);
	});
});

describe("the relations a binding asks to be loaded", () => {
	const rules = () => [
		allow("read", "post", { where: { status: "draft" } }),
		deny("read", "post", { where: { author: { role: "banned" } }, when: EU }),
	];
	const unloaded = { ...mine, author: undefined };

	it("are only those the rules that take part read", () => {
		const ability = withEnv(buildAbility(ac, rules()), IN_US);

		expect(ability.can("read", "post", unloaded)).toBe(true);
		expect(JSON.stringify(ability.where("read", "post"))).not.toContain(
			"author",
		);
	});

	it("include those of a deny that stays, in its environment and where the key is lacking", () => {
		for (const env of [IN_EU, NOWHERE]) {
			const ability = withEnv(buildAbility(ac, rules()), env);

			expect(() => ability.can("read", "post", unloaded)).toThrow(
				RelationNotLoadedError,
			);
			expect(JSON.stringify(ability.where("read", "post"))).toContain("author");
		}
	});
});

describe("bindings", () => {
	it("answer each for its own environment, asked in any interleaving", () => {
		const unbound = buildAbility(ac, [
			allow("read", "post", { when: EU }),
			allow("update", "post"),
			deny("update", "post", { when: { mfa: { ne: true } } }),
		]);
		const eu = withEnv(unbound, IN_EU);
		const us = withEnv(unbound, IN_US);
		const noMfa = withEnv(unbound, { ...IN_EU, mfa: false });

		for (let round = 0; round < 3; round++) {
			expect(us.can("read", "post", mine)).toBe(false);
			expect(eu.can("read", "post", mine)).toBe(true);
			expect(noMfa.can("update", "post", mine)).toBe(false);
			expect(us.can("update", "post", mine)).toBe(true);
			expect(eu.can("read", "post")).toBe(true);
			expect(us.can("read", "post")).toBe(false);
			expect(withEnv(unbound, IN_US).can("read", "post", mine)).toBe(false);
		}
	});

	it("keep apart environments that drop different rules of one pair", () => {
		const unbound = buildAbility(ac, [
			allow("read", "post", { where: { status: "draft" }, when: EU }),
			allow("read", "post", {
				where: { status: "review" },
				when: { mfa: true },
			}),
		]);
		const eu = withEnv(unbound, { ...IN_EU, mfa: false });
		const mfa = withEnv(unbound, { ...IN_US, mfa: true });

		for (let round = 0; round < 2; round++) {
			expect(eu.can("read", "post", mine)).toBe(true);
			expect(mfa.can("read", "post", mine)).toBe(false);
			expect(mfa.can("read", "post", { ...mine, status: "review" })).toBe(true);
			expect(eu.can("read", "post", { ...mine, status: "review" })).toBe(false);
		}
	});

	it("keep the hook, the rules and the schema of the ability they bind", () => {
		const heard: string[] = [];
		const rules = [allow("read", "post", { when: EU })];
		const unbound = buildAbility(ac, rules, {
			onDecision: (decision) =>
				heard.push(`${decision.action}:${decision.allowed}`),
		});
		const ability = withEnv(unbound, IN_EU);

		ability.can("read", "post", mine);
		withEnv(unbound, IN_US).can("read", "post", mine);

		expect(heard).toEqual(["read:true", "read:false"]);
		expect(ability.rules).toEqual(rules);
		expect(ability.validate("post", mine).ok).toBe(true);
		expect(() =>
			withEnv(unbound, IN_US).authorize("read", "post", mine),
		).toThrow(ForbiddenError);
	});

	it("can be bound again, and then answer for the new environment", () => {
		const eu = withEnv(
			buildAbility(ac, [allow("read", "post", { when: EU })]),
			IN_EU,
		);
		const rebound = withEnv(eu as unknown as AbilityForEnv<typeof ac>, IN_US);

		expect(eu.can("read", "post", mine)).toBe(true);
		expect(rebound.can("read", "post", mine)).toBe(false);
	});
});

describe("writing when", () => {
	it("compiles to field nodes and groups, as where does", () => {
		const rule = allow("read", "post", {
			when: {
				or: [{ hour: { gte: 9 } }, { not: { region: "eu" } }],
				mfa: true,
			},
		});

		expect(rule.when).toEqual({
			and: [
				{
					or: [
						{ field: "hour", op: "gte", value: 9 },
						{ not: { field: "region", op: "eq", value: "eu" } },
					],
				},
				{ field: "mfa", op: "eq", value: true },
			],
		});
		expect(fromOutside(JSON.parse(JSON.stringify([rule])))).toEqual([rule]);
	});

	it("refuses a key that would be lost on the way to JSON", () => {
		expect(() =>
			allow("read", "post", { when: { region: undefined } as never }),
		).toThrow(/when\.region is undefined/);
		expect(() =>
			allow("read", "post", { when: { [Symbol("region")]: "eu" } as never }),
		).toThrow(/when names Symbol\(region\)/);
	});

	it("compiles only against the declared environment", () => {
		const written = () => [
			// @ts-expect-error the environment declares no such key
			allow("read", "post", { when: { country: "de" } }),
			// @ts-expect-error a key of the row is not a key of the environment
			allow("read", "post", { when: { status: "draft" } }),
			// @ts-expect-error the environment has no relations
			allow("read", "post", { when: { author: { role: "admin" } } }),
			// @ts-expect-error contains reads a string, and the hour is a number
			allow("read", "post", { when: { hour: { contains: "1" } } }),
			// @ts-expect-error a condition names at least one key
			allow("read", "post", { when: {} }),
			// @ts-expect-error a declaration without an environment takes no when
			createRules(plainAc).allow("read", "post", { when: { region: "eu" } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("asks for an environment before any question, and for every key of it", () => {
		const unbound = buildAbility(ac, []);

		expectTypeOf(unbound).toEqualTypeOf<AbilityForEnv<typeof ac>>();
		expectTypeOf(withEnv(unbound, IN_EU)).toEqualTypeOf<Ability<typeof ac>>();
		expectTypeOf(buildAbility(plainAc, [])).toEqualTypeOf<
			Ability<typeof plainAc>
		>();

		const asked = () => [
			// @ts-expect-error an unbound ability answers nothing
			unbound.can("read", "post"),
			// @ts-expect-error a binding names every key the environment declares
			withEnv(unbound, { hour: 10, region: "eu" }),
			// @ts-expect-error an ability without an environment has nothing to bind
			withEnv(buildAbility(plainAc, []), IN_EU),
		];

		expect(asked).toBeTypeOf("function");
	});
});

describe("when that arrives from outside", () => {
	it("is checked as a condition on the environment", () => {
		const rule = (when: unknown) => [
			{ effect: "allow", action: "read", resource: "post", when },
		];

		expect(
			parseRules(
				rule({
					or: [
						{ field: "hour", op: "gte", value: 9 },
						{ not: { field: "region", op: "eq", value: "eu" } },
					],
				}),
			).ok,
		).toBe(true);
		expect(
			parseRules(
				rule({
					relation: "author",
					type: "one",
					where: { field: "role", op: "eq", value: "admin" },
				}),
			),
		).toEqual({
			ok: false,
			errors: ["rules[0].when: the environment has no relations"],
		});
		expect(parseRules(rule({ field: "hour", op: "like", value: 9 }))).toEqual({
			ok: false,
			errors: ['rules[0].when.op: unknown operator "like"'],
		});
		expect(parseRules(rule({ and: [] }))).toEqual({
			ok: false,
			errors: [
				"rules[0].when.and: expected at least one condition — an empty group says nothing about a row",
			],
		});
		expect(parseRules(rule("eu")).ok).toBe(false);
	});
});

describe("every permission against every prohibition, with when on either, in every environment", () => {
	type Action = "update" | "manage";
	type Make = (action: Action, when: boolean) => CheckedRule;

	const PERMITTED = { status: { in: ["draft", "review"] } };
	const FORBIDDEN = { status: "archived" };
	const MINE = { authorId: "u1" };

	const permissions: [name: string, make: Make][] = [
		[
			"allow post",
			(action, when) => allow(action, "post", when ? { when: EU } : {}),
		],
		[
			"allow {status, title}",
			(action, when) =>
				allow(action, { post: ["status", "title"] }, when ? { when: EU } : {}),
		],
		[
			"allow post with values",
			(action, when) =>
				allow(
					action,
					"post",
					when ? { values: PERMITTED, when: EU } : { values: PERMITTED },
				),
		],
		[
			"allow post where mine",
			(action, when) =>
				allow(
					action,
					"post",
					when ? { where: MINE, when: EU } : { where: MINE },
				),
		],
	];

	const prohibitions: [name: string, make: Make][] = [
		[
			"deny post",
			(action, when) => deny(action, "post", when ? { when: EU } : {}),
		],
		[
			"deny {title}",
			(action, when) =>
				deny(action, { post: ["title"] }, when ? { when: EU } : {}),
		],
		[
			"deny values",
			(action, when) =>
				deny(
					action,
					"post",
					when ? { values: FORBIDDEN, when: EU } : { values: FORBIDDEN },
				),
		],
		[
			"deny post where mine",
			(action, when) =>
				deny(
					action,
					"post",
					when ? { where: MINE, when: EU } : { where: MINE },
				),
		],
	];

	const ENVIRONMENTS: [name: string, env: Env | undefined][] = [
		["an environment that meets when", IN_EU],
		["an environment that fails it", IN_US],
		["an environment that lacks its key", NOWHERE],
		["no binding", undefined],
	];

	const placements: [name: string, allowAction: Action, denyAction: Action][] =
		[
			["no manage", "update", "update"],
			["manage on the allow", "manage", "update"],
			["manage on the deny", "update", "manage"],
			["manage on both", "manage", "manage"],
		];

	const PAYLOADS = [
		{ status: "draft" },
		{ status: "archived" },
		{ title: "t" },
		{ id: "x" },
	];

	const takesPart = (rule: CheckedRule, env: Env | undefined): boolean => {
		if (rule.when === undefined || env === IN_EU) {
			return true;
		}

		return env !== IN_US && rule.effect === "deny";
	};

	const withoutWhen = ({ when: _when, ...rule }: CheckedRule): CheckedRule =>
		rule as CheckedRule;

	const answersOf = (ability: Ability<typeof ac>) =>
		(["update", "read"] as const).map((action) => ({
			action,
			where: ability.where(action, "post"),
			rows: [mine, theirs, undefined].map((row) => ({
				can: ability.can(action, "post", row),
				canMutate: ability.canMutate(action, "post", row),
				authorize: (() => {
					try {
						ability.authorize(action, "post", row);

						return "passed";
					} catch (error) {
						return (error as Error).constructor.name;
					}
				})(),
				payloads: PAYLOADS.map((data) =>
					ability.validatePayload(action, "post", row, data),
				),
				fields: ability.permittedFields(action, "post", row, [
					"status",
					"title",
					"id",
				]),
			})),
		}));

	for (const [permissionName, permission] of permissions) {
		for (const [prohibitionName, prohibition] of prohibitions) {
			it(`${permissionName} against ${prohibitionName}`, () => {
				for (const [allowWhen, denyWhen] of [
					[true, false],
					[false, true],
					[true, true],
				] as const) {
					for (const [placement, allowAction, denyAction] of placements) {
						const rules = [
							permission(allowAction, allowWhen),
							prohibition(denyAction, denyWhen),
						];

						for (const policy of [rules, [...rules].reverse()]) {
							for (const [envName, env] of ENVIRONMENTS) {
								const built = buildAbility(ac, policy);
								const actual =
									env === undefined
										? (built as unknown as Ability<typeof ac>)
										: withEnv(built, env);
								const reference = buildAbility(
									plainAc,
									policy
										.filter((rule) => takesPart(rule, env))
										.map(withoutWhen),
								);

								expect({
									allowWhen,
									denyWhen,
									placement,
									envName,
									answers: answersOf(actual),
								}).toEqual({
									allowWhen,
									denyWhen,
									placement,
									envName,
									answers: answersOf(
										reference as unknown as Ability<typeof ac>,
									),
								});
							}
						}
					}
				}
			});
		}
	}
});
