import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Ability, Decision } from "../../src/api/index.js";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import {
	ForbiddenError,
	RelationNotLoadedError,
} from "../../src/errors/index.js";
import type { CheckedRule, CheckedRules } from "../../src/model/index.js";

type Post = {
	authorId: string;
	status: "draft" | "published";
	title: string;
	views: number;
	comments?: { spam: boolean }[];
};

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update", "delete"],
			relations: { comments: { resource: "comment", kind: "many" } },
		},
		comment: { schema: shape<{ spam: boolean }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = {
	authorId: "u1",
	status: "published",
	title: "hi",
	views: 20,
};
const theirs: Post = { ...post, authorId: "u2" };
const broken = { ...post, views: "abc" } as unknown as Post;

const grant = allow("update", "post");
const blanket = deny("update", "post");
const mineOnly = allow("update", "post", { where: { authorId: "u1" } });
const busyOut = deny("update", "post", { where: { views: { gt: 10 } } });

describe("buildAbility", () => {
	it("exposes a copy of its rules, branded for the client", () => {
		const policy = [grant];
		const ability = buildAbility(ac, policy);

		policy.push(blanket);

		expect(ability.rules).toEqual([grant]);
		expect(ability.can("update", "post", post)).toBe(true);
		expectTypeOf(ability.rules).toEqualTypeOf<readonly CheckedRule[]>();
		expect(() => buildAbility(ac, ability.rules)).not.toThrow();
	});

	it("keeps dirty rules as-is — does not throw, drop, or warn", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const dirty = buildAbility(ac, [
			{ effect: "allow", action: "read", resource: "post" },
			{ effect: "allow", action: "create", resource: "post" },
			{ effect: "deny", action: "delete", resource: "psot" },
		] as CheckedRules);

		expect(dirty.rules).toHaveLength(3);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("the answer each call gives", () => {
	type Calls = {
		can: boolean;
		cannot: boolean;
		authorize: boolean;
		canMutate: boolean;
	};

	const refusesToAuthorize = (run: () => void): boolean => {
		try {
			run();
			return false;
		} catch (error) {
			if (ForbiddenError.is(error)) {
				return true;
			}

			throw error;
		}
	};

	const callsOf = (ability: Ability, row?: Post): Calls => ({
		can: ability.can("update", "post", row),
		cannot: ability.cannot("update", "post", row),
		authorize: !refusesToAuthorize(() =>
			ability.authorize("update", "post", row),
		),
		canMutate: ability.canMutate("update", "post", row),
	});

	const settled = (allowed: boolean): Calls => ({
		can: allowed,
		cannot: !allowed,
		authorize: allowed,
		canMutate: allowed,
	});

	const optimistic: Calls = {
		can: true,
		cannot: false,
		authorize: false,
		canMutate: false,
	};

	it.each([
		["a settled grant, with a row", [grant], post, settled(true)],
		["a settled grant, without a row", [grant], undefined, settled(true)],
		["a settled refusal, with a row", [grant, blanket], post, settled(false)],
		[
			"a settled refusal, without a row",
			[grant, blanket],
			undefined,
			settled(false),
		],
		[
			"an allow that needs the row, without one",
			[mineOnly],
			undefined,
			optimistic,
		],
		[
			"a deny that needs the row, without one",
			[grant, busyOut],
			undefined,
			optimistic,
		],
		["an open answer, with a row", [grant, busyOut], broken, settled(false)],
	] as [
		string,
		CheckedRule[],
		Post | undefined,
		Calls,
	][])("%s", (_name, rules, row, expected) => {
		expect(callsOf(buildAbility(ac, rules), row)).toEqual(expected);
	});

	it("refuses a row it will not read from every call, where a plain copy passes", () => {
		const ability = buildAbility(ac, [
			allow(
				"update",
				{ post: ["title", "status"] },
				{ where: { authorId: "u1" } },
			),
		]);
		const fields: ("title" | "status")[] = ["title", "status"];
		const entity = Object.assign(new (class PostEntity {})(), post);

		expect(ability.can("update", "post", { ...post })).toBe(true);
		expect(
			ability.permittedFields("update", "post", { ...post }, fields),
		).toEqual(fields);

		for (const row of [entity, [post], new Date()] as Post[]) {
			expect(ability.can("update", "post", row)).toBe(false);
			expect(ability.canMutate("update", "post", row)).toBe(false);
			expect(
				ability.validatePayload("update", "post", row, { title: "t" }).ok,
			).toBe(false);
			expect(ability.permittedFields("update", "post", row, fields)).toEqual(
				[],
			);
		}
	});

	it("carries action and resource on the error, and no violations", () => {
		expect.assertions(4);

		try {
			buildAbility(ac, []).authorize("delete", "post", post);
		} catch (error) {
			expect(error).toBeInstanceOf(ForbiddenError);
			const forbidden = error as ForbiddenError;
			expect(forbidden.action).toBe("delete");
			expect(forbidden.resource).toBe("post");
			expect(forbidden.violations).toBeUndefined();
		}
	});
});

describe("the decision each call reports", () => {
	const heard = (rules: CheckedRule[], ask: (ability: Ability) => unknown) => {
		const seen: Decision[] = [];

		ask(
			buildAbility(ac, rules, {
				onDecision: (decision) => seen.push(decision),
			}),
		);

		return seen.map(
			({ action: _action, resource: _resource, ...rest }) => rest,
		);
	};

	it("names the allow behind a grant, settled or optimistic", () => {
		expect(
			heard([grant], (ability) => ability.can("update", "post", post)),
		).toEqual([{ allowed: true, rule: grant }]);
		expect(
			heard([mineOnly], (ability) => ability.can("update", "post")),
		).toEqual([{ allowed: true, rule: mineOnly }]);
	});

	it("names the deny behind a settled refusal, with a row or without one", () => {
		for (const row of [post, undefined]) {
			expect(
				heard([grant, blanket], (ability) =>
					ability.canMutate("update", "post", row),
				),
			).toEqual([{ allowed: false, rule: blanket }]);
		}
	});

	it("names the deny that read the row, even when its answer was open", () => {
		expect(
			heard([grant, busyOut], (ability) =>
				ability.canMutate("update", "post", broken),
			),
		).toEqual([{ allowed: false, rule: busyOut }]);
	});

	it("names no rule when a deciding call refuses for want of a row", () => {
		for (const rules of [[mineOnly], [grant, busyOut]]) {
			expect(
				heard(rules, (ability) => ability.canMutate("update", "post")),
			).toEqual([{ allowed: false }]);
		}
	});

	it("names no rule when nothing grants", () => {
		expect(
			heard([mineOnly], (ability) => ability.can("update", "post", theirs)),
		).toEqual([{ allowed: false }]);
	});

	it("says why when the row is not a plain object", () => {
		const notPlain = [] as unknown as Post;

		expect(
			heard([grant], (ability) => ability.can("update", "post", notPlain)),
		).toEqual([{ allowed: false, reason: "not a plain row" }]);
		expect(
			heard([grant], (ability) =>
				ability.validatePayload("update", "post", notPlain, { title: "t" }),
			),
		).toEqual([{ allowed: false, violations: [], reason: "not a plain row" }]);
	});

	it("reports a write with its violations and no rule", () => {
		expect(
			heard([allow("update", { post: ["title"] })], (ability) =>
				ability.validatePayload("update", "post", post, {
					title: "t",
					views: 1,
				}),
			),
		).toEqual([
			{
				allowed: false,
				violations: [{ field: "views", reason: "field not permitted" }],
			},
		]);
		expect(
			heard([grant], (ability) =>
				ability.validatePayload("update", "post", post, { title: "t" }),
			),
		).toEqual([{ allowed: true }]);
	});

	it("answers the same with a hook as without one, whatever the hook does", () => {
		const rules = [
			grant,
			deny("update", "post", { where: { status: "draft" } }),
		];
		const silent = buildAbility(ac, rules);
		const meddling = buildAbility(ac, rules, {
			onDecision: (decision) => {
				(decision as { allowed: boolean }).allowed = !decision.allowed;
			},
		});

		for (const row of [post, { ...post, status: "draft" as const }]) {
			expect(meddling.can("update", "post", row)).toBe(
				silent.can("update", "post", row),
			);
		}
	});

	it("lets a broken hook surface instead of hiding it", () => {
		const ability = buildAbility(ac, [grant], {
			onDecision: () => {
				throw new TypeError("the log is down");
			},
		});

		expect(() => ability.can("update", "post", post)).toThrow(TypeError);
	});
});

describe("the questions about a policy", () => {
	it("hands a database the condition the rules compile to", () => {
		const ability = buildAbility(ac, [mineOnly]);

		expect(ability.where("update", "post")).toEqual({
			field: "authorId",
			op: "eq",
			value: "u1",
		});
		expect(ability.where("delete", "post")).toEqual({ or: [] });
	});

	it("types permittedFields as the fields that were asked about", () => {
		const ability = buildAbility(ac, [allow("update", { post: ["title"] })]);
		const asked: "title"[] = ability.permittedFields(
			"update",
			"post",
			undefined,
			["title"],
		);

		expect(asked).toEqual(["title"]);
	});

	it("fails validate closed for a resource that is not in the registry", () => {
		// @ts-expect-error unregistered resource
		expect(buildAbility(ac, []).validate("unknown", { foo: "bar" })).toEqual({
			ok: false,
			issues: [{ message: 'unknown resource "unknown"' }],
		});
	});

	it("passes object data through the phantom schema of a known resource", () => {
		expect(buildAbility(ac, []).validate("post", { authorId: "u1" })).toEqual({
			ok: true,
			value: { authorId: "u1" },
		});
	});

	it("throws for a relation never loaded on the payload path too", () => {
		const ability = buildAbility(ac, [
			allow(
				"update",
				{ post: ["status"] },
				{ where: { views: 0, comments: { some: { spam: true } } } },
			),
		]);

		expect(() =>
			ability.validatePayload("update", "post", post, { status: "draft" }),
		).toThrow(RelationNotLoadedError);
	});
});
