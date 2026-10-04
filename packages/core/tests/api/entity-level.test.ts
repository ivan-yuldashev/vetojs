import { describe, expect, it } from "vitest";
import type { Ability } from "../../src/api/index.js";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { ForbiddenError } from "../../src/errors/index.js";
import type { CheckedRules, Rule } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Post = { id: string; authorId: string };
type Comment = { id: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update", "delete"] },
		comment: { schema: shape<Comment>(), actions: ["read", "delete"] },
		user: { schema: shape<{ id: string }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = { id: "p1", authorId: "u1" };
const comment: Comment = { id: "c1" };

const fromOutside = (json: unknown): CheckedRules => {
	const parsed = parseRules(json);

	if (!parsed.ok) {
		throw new Error(parsed.errors.join("\n"));
	}

	return parsed.rules;
};

const GRANTED = { can: true, where: { and: [] } };
const REFUSED = { can: false, where: { or: [] } };

const answers = (ability: Ability, action: string, resource: string) => ({
	can: ability.can(action, resource, { id: "x" }),
	where: ability.where(action, resource),
});

describe("one action", () => {
	it("grants the action it names, with a row and without one", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "post")).toBe(true);
		expect(ability.cannot("read", "post", post)).toBe(false);
		expect(() => ability.authorize("read", "post")).not.toThrow();
		expect(ability.canMutate("read", "post")).toBe(true);
	});

	it("grants nothing else on the resource", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);

		expect(ability.can("update", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
		expect(ability.can("delete", "post", post)).toBe(false);
	});

	it("grants nothing when only a deny names the action", () => {
		const ability = buildAbility(ac, [deny("read", "post")]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post")).toBe(false);
	});

	it("refuses everything when no rule names the action", () => {
		const ability = buildAbility(ac, []);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post")).toBe(false);
		expect(() => ability.authorize("read", "post")).toThrow(ForbiddenError);
		expect(ability.canMutate("read", "post")).toBe(false);
	});
});

describe("an effect that is neither allow nor deny", () => {
	it("is refused from outside", () => {
		expect(
			parseRules([{ effect: "Allow", action: "read", resource: "post" }]).ok,
		).toBe(false);
	});
});

describe("a list of actions", () => {
	it("grants every action in the list, and only those", () => {
		const ability = buildAbility(ac, [allow(["read", "update"], "post")]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(true);
		expect(ability.can("update", "post")).toBe(true);
		expect(ability.can("delete", "post", post)).toBe(false);
		expect(ability.can("delete", "post")).toBe(false);
	});

	it("takes away every action a deny lists, and nothing it does not", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update", "delete"], "post"),
			deny(["read", "update"], "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
		expect(ability.can("delete", "post", post)).toBe(true);
		expect(ability.can("delete", "post")).toBe(true);
	});
});

describe("an action the resource does not declare", () => {
	it("does not compile in a rule", () => {
		const written = () => [
			// @ts-expect-error post declares no archive
			allow("archive", "post"),
			// @ts-expect-error nor does a deny get to name it
			deny("archive", "post"),
		];

		expect(written).toBeTypeOf("function");
	});

	it("does not compile when the action belongs to another resource", () => {
		const written = () => [
			// @ts-expect-error update is declared on post, not on user
			allow("update", "user"),
			// @ts-expect-error delete is declared on post and comment, not on user
			deny("delete", "user"),
			// @ts-expect-error the same with fields on the target
			allow("update", { user: ["id"] }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("does not compile in a question", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);
		const asked = () => [
			// @ts-expect-error post declares no archive
			ability.can("archive", "post"),
			// @ts-expect-error update is declared on post, not on user
			ability.can("update", "user"),
		];

		expect(asked).toBeTypeOf("function");
	});

	it("is refused when asked anyway", () => {
		const ability = buildAbility(ac, [allow(["read", "update"], "post")]);

		expect(ability.can("archive" as "read", "post", post)).toBe(false);
		expect(ability.can("archive" as "read", "post")).toBe(false);
	});

	it("grants only its own name when it arrives in a rule from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([{ effect: "allow", action: "archive", resource: "post" }]),
		);

		expect(ability.can("archive" as "read", "post", post)).toBe(true);
		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
	});
});

describe("an empty list of actions", () => {
	it("does not compile", () => {
		const written = () => [
			// @ts-expect-error a rule names at least one action
			allow([], "post"),
			// @ts-expect-error a deny naming none protects nothing
			deny([], "post"),
			// @ts-expect-error nor may a rule written as data
			{ effect: "deny", action: [], resource: "post" } satisfies Rule,
		];

		expect(written).toBeTypeOf("function");
	});

	it("is refused when a rule arrives from outside", () => {
		expect(
			parseRules([{ effect: "deny", action: [], resource: "post" }]),
		).toEqual({
			ok: false,
			errors: [
				"rules[0].action: expected at least one action — naming none says nothing about a request",
			],
		});
		expect(
			parseRules([{ effect: "allow", action: "", resource: "post" }]).ok,
		).toBe(false);
		expect(
			parseRules([{ effect: "allow", action: ["read", ""], resource: "post" }])
				.ok,
		).toBe(false);
	});

	it("grants nothing if one gets past the checks", () => {
		const ability = buildAbility(ac, [
			{ effect: "allow", action: [], resource: "post" },
		] as unknown as CheckedRules);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post")).toBe(false);
	});
});

describe("an undeclared action inside a list", () => {
	it("does not compile", () => {
		const written = () => [
			// @ts-expect-error post declares no archive
			allow(["read", "archive"], "post"),
			// @ts-expect-error nor does a deny list get to name it
			deny(["update", "archive"], "post"),
		];

		expect(written).toBeTypeOf("function");
	});

	it("keeps the declared names when the list arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: ["read", "archive"], resource: "post" },
			]),
		);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("archive" as "read", "post")).toBe(true);
		expect(ability.can("update", "post", post)).toBe(false);
	});

	it("still takes away the declared names when a deny list arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: ["read", "update"], resource: "post" },
				{ effect: "deny", action: ["update", "archive"], resource: "post" },
			]),
		);

		expect(ability.can("update", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
		expect(ability.can("read", "post", post)).toBe(true);
	});
});

describe("a resource", () => {
	it("keeps a grant on its own resource", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);

		expect(ability.can("read", "comment", comment)).toBe(false);
		expect(ability.can("read", "comment")).toBe(false);
	});

	it("keeps a deny on its own resource", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			allow("read", "comment"),
			deny("read", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "comment", comment)).toBe(true);
		expect(ability.can("read", "comment")).toBe(true);
	});
});

describe("a resource nobody declared", () => {
	it("does not compile in a rule or a question", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);
		const written = () => [
			// @ts-expect-error nobody declared ghost
			allow("read", "ghost"),
			// @ts-expect-error nor may a deny name it
			deny("read", "ghost"),
			// @ts-expect-error nor may a question
			ability.can("read", "ghost"),
		];

		expect(written).toBeTypeOf("function");
	});

	it("does not compile with manage, which fits any resource", () => {
		const written = () => [
			// @ts-expect-error manage does not make ghost a resource
			allow("manage", "ghost"),
			// @ts-expect-error nor does it for a deny
			deny("manage", "ghost"),
		];

		expect(written).toBeTypeOf("function");
	});

	it("is refused when asked anyway", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);

		expect(ability.can("read", "ghost" as "post", post)).toBe(false);
		expect(ability.can("read", "ghost" as "post")).toBe(false);
	});

	it("stays apart when a rule for it arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([{ effect: "allow", action: "read", resource: "ghost" }]),
		);

		expect(ability.can("read", "ghost" as "post")).toBe(true);
		expect(ability.can("read", "post", post)).toBe(false);
	});

	it("refuses an empty resource name from outside", () => {
		expect(
			parseRules([{ effect: "allow", action: "read", resource: "" }]),
		).toEqual({
			ok: false,
			errors: [
				"rules[0].resource: expected a resource name — an empty one matches nothing",
			],
		});
	});
});

describe("permissions add up", () => {
	it("grants the union of what each allow grants", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			allow("update", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(true);
		expect(ability.can("update", "post")).toBe(true);
		expect(ability.can("delete", "post", post)).toBe(false);
		expect(ability.can("delete", "post")).toBe(false);
	});

	it("adds up across resources without mixing them", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			allow("delete", "comment"),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("delete", "comment", comment)).toBe(true);
		expect(ability.can("delete", "post", post)).toBe(false);
		expect(ability.can("read", "comment", comment)).toBe(false);
	});

	it("lets one deny take away an action granted twice", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			allow(["read", "update"], "post"),
			deny("read", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post")).toBe(false);
		expect(ability.can("update", "post", post)).toBe(true);
	});
});

describe("a deny takes away", () => {
	it("takes the action away, with a row and without one", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post")).toBe(false);
		expect(ability.cannot("read", "post", post)).toBe(true);
	});

	it("takes it away wherever it is written", () => {
		const ability = buildAbility(ac, [
			deny("read", "post"),
			allow("read", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("read", "post")).toBe(false);
	});

	it("makes authorize throw, with a row and without one", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post"),
		]);

		expect(() => ability.authorize("read", "post", post)).toThrow(
			ForbiddenError,
		);
		expect(() => ability.authorize("read", "post")).toThrow(ForbiddenError);
	});

	it("takes away only the action it names", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], "post"),
			deny("update", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("read", "post")).toBe(true);
		expect(ability.can("update", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
	});
});

describe("manage minus a deny", () => {
	it("keeps every action but the one taken away", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny("delete", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post")).toBe(true);
		expect(ability.can("delete", "post", post)).toBe(false);
		expect(ability.can("delete", "post")).toBe(false);
		expect(() => ability.authorize("delete", "post", post)).toThrow(
			ForbiddenError,
		);
		expect(() => ability.authorize("read", "post")).not.toThrow();
		expect(ability.canMutate("update", "post")).toBe(true);
		expect(ability.canMutate("delete", "post")).toBe(false);
	});

	it("takes the action away wherever the deny is written", () => {
		const ability = buildAbility(ac, [
			deny("delete", "post"),
			allow("manage", "post"),
		]);

		expect(ability.can("delete", "post", post)).toBe(false);
		expect(ability.can("delete", "post")).toBe(false);
		expect(ability.can("read", "post", post)).toBe(true);
	});

	it("takes away every action a deny lists", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny(["update", "delete"], "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(false);
		expect(ability.can("delete", "post")).toBe(false);
	});

	it("takes away everything when the deny is manage too", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny("manage", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
		expect(ability.can("delete", "post", post)).toBe(false);
	});

	it("lets a deny written as manage take away a single allow", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], "post"),
			deny("manage", "post"),
		]);

		expect(ability.can("read", "post", post)).toBe(false);
		expect(ability.can("update", "post")).toBe(false);
	});

	it("does not reach another resource", () => {
		const ability = buildAbility(ac, [
			allow("read", "comment"),
			deny("manage", "post"),
		]);

		expect(ability.can("read", "comment", comment)).toBe(true);
		expect(ability.can("read", "comment")).toBe(true);
	});
});

describe("manage", () => {
	it("grants every action the resource declares", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);

		expect(ability.can("read", "post", post)).toBe(true);
		expect(ability.can("update", "post", post)).toBe(true);
		expect(ability.can("delete", "post")).toBe(true);
	});

	it("stays on its own resource", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);

		expect(ability.can("read", "comment", comment)).toBe(false);
		expect(ability.can("delete", "comment")).toBe(false);
	});

	it("grants the same inside a list", () => {
		const ability = buildAbility(ac, [allow(["read", "manage"], "post")]);

		expect(ability.can("delete", "post", post)).toBe(true);
		expect(ability.can("update", "post")).toBe(true);
	});

	it("is not something a question may name", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);
		const asked = () => [
			// @ts-expect-error manage is written in a rule, never asked
			ability.can("manage", "post"),
			// @ts-expect-error the same for cannot
			ability.cannot("manage", "post"),
			// @ts-expect-error and for authorize
			ability.authorize("manage", "post"),
			// @ts-expect-error and for canMutate
			ability.canMutate("manage", "post"),
			// @ts-expect-error and for where
			ability.where("manage", "post"),
			// @ts-expect-error and for permittedFields
			ability.permittedFields("manage", "post", undefined, ["id"]),
			// @ts-expect-error and for validatePayload
			ability.validatePayload("manage", "post", undefined, { id: "p2" }),
		];

		expect(asked).toBeTypeOf("function");
	});

	it("refuses a question about manage that gets past the types", () => {
		const everything = buildAbility(ac, [allow("manage", "post")]);
		const allButDelete = buildAbility(ac, [
			allow("manage", "post"),
			deny("delete", "post"),
		]);

		expect(everything.can("manage" as "read", "post", post)).toBe(false);
		expect(everything.can("manage" as "read", "post")).toBe(false);
		expect(allButDelete.can("manage" as "read", "post")).toBe(false);
		expect(() => allButDelete.authorize("manage" as "read", "post")).toThrow(
			ForbiddenError,
		);
	});

	it("still grants an action nobody declared", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);

		expect(ability.can("archive" as "read", "post", post)).toBe(true);
	});
});

describe("where() selects the rows can() allows", () => {
	it("selects every row for a grant and none for anything else", () => {
		const ability = buildAbility(ac, [allow("read", "post")]);

		expect(answers(ability, "read", "post")).toEqual(GRANTED);
		expect(answers(ability, "update", "post")).toEqual(REFUSED);
		expect(answers(ability, "read", "comment")).toEqual(REFUSED);
	});

	it("selects no row once a deny takes the action away, wherever it is written", () => {
		const denyAfter = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post"),
		]);
		const denyBefore = buildAbility(ac, [
			deny("read", "post"),
			allow("read", "post"),
		]);

		expect(answers(denyAfter, "read", "post")).toEqual(REFUSED);
		expect(answers(denyBefore, "read", "post")).toEqual(REFUSED);
	});

	it("reads a list as each of its actions", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], "post"),
			deny(["update", "delete"], "post"),
		]);

		expect(answers(ability, "read", "post")).toEqual(GRANTED);
		expect(answers(ability, "update", "post")).toEqual(REFUSED);
		expect(answers(ability, "delete", "post")).toEqual(REFUSED);
	});

	it("keeps what manage leaves after a deny", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny("delete", "post"),
		]);

		expect(answers(ability, "read", "post")).toEqual(GRANTED);
		expect(answers(ability, "update", "post")).toEqual(GRANTED);
		expect(answers(ability, "delete", "post")).toEqual(REFUSED);
		expect(answers(ability, "read", "comment")).toEqual(REFUSED);
	});

	it("selects no row under a deny written as manage, and only on its resource", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], "post"),
			allow("read", "comment"),
			deny("manage", "post"),
		]);

		expect(answers(ability, "read", "post")).toEqual(REFUSED);
		expect(answers(ability, "update", "post")).toEqual(REFUSED);
		expect(answers(ability, "read", "comment")).toEqual(GRANTED);
	});

	it("selects no row for a question about manage", () => {
		const ability = buildAbility(ac, [allow("manage", "post")]);

		expect(answers(ability, "manage", "post")).toEqual(REFUSED);
	});

	it("reads names nobody declared as can() does", () => {
		const fromDatabase = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "archive", resource: "post" },
				{ effect: "allow", action: "read", resource: "ghost" },
			]),
		);
		const managing = buildAbility(ac, [allow("manage", "post")]);

		expect(answers(fromDatabase, "archive", "post")).toEqual(GRANTED);
		expect(answers(fromDatabase, "read", "post")).toEqual(REFUSED);
		expect(answers(fromDatabase, "read", "ghost")).toEqual(GRANTED);
		expect(answers(managing, "archive", "post")).toEqual(GRANTED);
		expect(answers(managing, "read", "ghost")).toEqual(REFUSED);
	});

	it("selects no row for a list emptied past the checks", () => {
		const ability = buildAbility(ac, [
			{ effect: "allow", action: [], resource: "post" },
		] as unknown as CheckedRules);

		expect(answers(ability, "read", "post")).toEqual(REFUSED);
	});
});

describe("two rules on the resource", () => {
	type Answer = {
		can: boolean;
		canWithoutRow: boolean;
		authorize: boolean;
		canMutate: boolean;
		where: unknown;
	};

	const refusesToAuthorize = (ability: Ability, action: string): boolean => {
		try {
			ability.authorize(action, "post");
			return false;
		} catch (error) {
			if (ForbiddenError.is(error)) {
				return true;
			}

			throw error;
		}
	};

	const answer = (ability: Ability, action: string): Answer => ({
		can: ability.can(action, "post", post),
		canWithoutRow: ability.can(action, "post"),
		authorize: !refusesToAuthorize(ability, action),
		canMutate: ability.canMutate(action, "post"),
		where: ability.where(action, "post"),
	});

	const yes: Answer = {
		can: true,
		canWithoutRow: true,
		authorize: true,
		canMutate: true,
		where: GRANTED.where,
	};

	const no: Answer = {
		can: false,
		canWithoutRow: false,
		authorize: false,
		canMutate: false,
		where: REFUSED.where,
	};

	const cases = [
		{
			name: "allow update + allow update",
			rules: [allow("update", "post"), allow("update", "post")],
			update: yes,
			delete: no,
		},
		{
			name: "allow manage + allow update",
			rules: [allow("manage", "post"), allow("update", "post")],
			update: yes,
			delete: yes,
		},
		{
			name: "allow update + allow manage",
			rules: [allow("update", "post"), allow("manage", "post")],
			update: yes,
			delete: yes,
		},
		{
			name: "allow manage + allow manage",
			rules: [allow("manage", "post"), allow("manage", "post")],
			update: yes,
			delete: yes,
		},
		{
			name: "allow update + deny update",
			rules: [allow("update", "post"), deny("update", "post")],
			update: no,
			delete: no,
		},
		{
			name: "allow manage + deny update",
			rules: [allow("manage", "post"), deny("update", "post")],
			update: no,
			delete: yes,
		},
		{
			name: "allow update + deny manage",
			rules: [allow("update", "post"), deny("manage", "post")],
			update: no,
			delete: no,
		},
		{
			name: "allow manage + deny manage",
			rules: [allow("manage", "post"), deny("manage", "post")],
			update: no,
			delete: no,
		},
		{
			name: "deny update + deny update",
			rules: [deny("update", "post"), deny("update", "post")],
			update: no,
			delete: no,
		},
		{
			name: "deny manage + deny update",
			rules: [deny("manage", "post"), deny("update", "post")],
			update: no,
			delete: no,
		},
		{
			name: "deny update + deny manage",
			rules: [deny("update", "post"), deny("manage", "post")],
			update: no,
			delete: no,
		},
		{
			name: "deny manage + deny manage",
			rules: [deny("manage", "post"), deny("manage", "post")],
			update: no,
			delete: no,
		},
	];

	for (const { name, rules, update, delete: remove } of cases) {
		it(`${name}: answers for the action it names, for one only manage reaches, and for nothing else, in either order`, () => {
			for (const policy of [rules, [...rules].reverse()]) {
				const ability = buildAbility(ac, policy);

				expect(answer(ability, "update")).toEqual(update);
				expect(answer(ability, "delete")).toEqual(remove);
				expect(answers(ability, "read", "comment")).toEqual(REFUSED);
			}
		});
	}
});
