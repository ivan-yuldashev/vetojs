import { describe, expect, it } from "vitest";
import type { Ability, Decision } from "../../src/api/index.js";
import { buildAbility } from "../../src/api/index.js";
import { compileMatcher } from "../../src/compile/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { ForbiddenError } from "../../src/errors/index.js";
import type { CheckedRule, CheckedRules } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Post = { id: string; authorId: string; status: string; name: string };
type Comment = { id: string; body: string };
type Field = "id" | "name" | "authorId";

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update", "delete"] },
		comment: { schema: shape<Comment>(), actions: ["read", "delete"] },
	},
});

const { allow, deny } = createRules(ac);

const rows = {
	mine: { id: "p1", authorId: "u1", status: "draft", name: "a" },
	theirs: { id: "p2", authorId: "u2", status: "draft", name: "b" },
	archived: { id: "p3", authorId: "u1", status: "archived", name: "c" },
} satisfies Record<string, Post>;

type RowName = keyof typeof rows;

const ROW_NAMES: RowName[] = ["mine", "theirs", "archived"];
const FIELDS: Field[] = ["id", "name", "authorId"];
const comment: Comment = { id: "c1", body: "hi" };

const MINE = { authorId: "u1" };
const THEIRS = { authorId: "u2" };
const ARCHIVED = { status: "archived" };

const fromOutside = (json: unknown): CheckedRules => {
	const parsed = parseRules(json);

	if (!parsed.ok) {
		throw new Error(parsed.errors.join("\n"));
	}

	return parsed.rules;
};

const rowsFor = (ability: Ability, action: string): RowName[] => {
	const granted = ROW_NAMES.filter((name) =>
		ability.can(action, "post", rows[name]),
	);
	const selected = ROW_NAMES.filter(
		(name) =>
			compileMatcher(ability.where(action, "post"))(rows[name]) === true,
	);

	expect(selected).toEqual(granted);

	return granted;
};

const refuses = (run: () => void): boolean => {
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

describe("one action", () => {
	it("grants the rows the condition holds for, and no others", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "archived"]);
		expect(ability.where("update", "post")).toEqual({
			field: "authorId",
			op: "eq",
			value: "u1",
		});
	});

	it("leaves can open without a row and makes the deciding calls refuse", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
		]);

		expect(ability.can("update", "post")).toBe(true);
		expect(refuses(() => ability.authorize("update", "post"))).toBe(true);
		expect(ability.canMutate("update", "post")).toBe(false);
		expect(refuses(() => ability.authorize("update", "post", rows.mine))).toBe(
			false,
		);
		expect(
			refuses(() => ability.authorize("update", "post", rows.theirs)),
		).toBe(true);
		expect(ability.canMutate("update", "post", rows.mine)).toBe(true);
		expect(ability.canMutate("update", "post", rows.theirs)).toBe(false);
	});

	it("grants nothing on another action", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
		]);

		expect(rowsFor(ability, "delete")).toEqual([]);
		expect(ability.can("delete", "post")).toBe(false);
	});

	it("grants nothing when only a deny carries the condition", () => {
		const ability = buildAbility(ac, [
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(rowsFor(ability, "update")).toEqual([]);
		expect(ability.where("update", "post")).toEqual({ or: [] });
		expect(ability.can("update", "post")).toBe(false);
		expect(refuses(() => ability.authorize("update", "post"))).toBe(true);
	});

	it("writes into its rows only, and refuses a write with no row to judge", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["name"] }, { where: MINE }),
		]);

		expect(
			ability.validatePayload("update", "post", rows.mine, { name: "x" }),
		).toEqual({ ok: true, data: { name: "x" } });
		expect(
			ability.validatePayload("update", "post", rows.theirs, { name: "x" }),
		).toEqual({ ok: false, violations: [] });
		expect(
			ability.validatePayload("update", "post", undefined, { name: "x" }),
		).toEqual({ ok: false, violations: [] });
		expect(
			ability.permittedFields("update", "post", undefined, FIELDS),
		).toEqual(["name"]);
		expect(
			ability.permittedFields("update", "post", rows.theirs, FIELDS),
		).toEqual([]);
	});

	it("offers no field of a row whose data the condition cannot read", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["name"] }, { where: MINE }),
		]);
		const garbled = { ...rows.mine, authorId: ["u1"] } as unknown as Post;

		expect(ability.permittedFields("update", "post", garbled, FIELDS)).toEqual(
			[],
		);
		expect(
			ability.validatePayload("update", "post", garbled, { name: "x" }),
		).toEqual({ ok: false, violations: [] });
	});
});

describe("a list of actions", () => {
	it("carries the condition to every action in the list, and only those", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], "post", { where: MINE }),
		]);

		expect(rowsFor(ability, "read")).toEqual(["mine", "archived"]);
		expect(rowsFor(ability, "update")).toEqual(["mine", "archived"]);
		expect(rowsFor(ability, "delete")).toEqual([]);
	});

	it("takes the rows away from every action a deny lists", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny(["read", "update"], "post", { where: ARCHIVED }),
		]);

		expect(rowsFor(ability, "read")).toEqual(["mine", "theirs"]);
		expect(rowsFor(ability, "update")).toEqual(["mine", "theirs"]);
		expect(rowsFor(ability, "delete")).toEqual(["mine", "theirs", "archived"]);
	});
});

describe("an action the resource does not declare", () => {
	it("does not compile in a rule", () => {
		const written = () => [
			// @ts-expect-error post declares no archive
			allow("archive", "post", { where: MINE }),
			// @ts-expect-error update is declared on post, not on comment
			deny("update", "comment", { where: { body: "x" } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("means only its own name and rows when it arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: "archive",
					resource: "post",
					where: { field: "authorId", op: "eq", value: "u1" },
				},
			]),
		);

		expect(rowsFor(ability, "archive")).toEqual(["mine", "archived"]);
		expect(rowsFor(ability, "update")).toEqual([]);
	});
});

describe("an empty list of actions", () => {
	it("does not compile, and is refused when it arrives from outside", () => {
		const written = () => [
			// @ts-expect-error a rule names at least one action
			allow([], "post", { where: MINE }),
		];

		expect(written).toBeTypeOf("function");
		expect(
			parseRules([
				{
					effect: "deny",
					action: [],
					resource: "post",
					where: { field: "authorId", op: "eq", value: "u1" },
				},
			]).ok,
		).toBe(false);
	});
});

describe("an undeclared action inside a list", () => {
	it("keeps the declared names, for an allow and for a deny", () => {
		const granting = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: ["update", "archive"],
					resource: "post",
					where: { field: "authorId", op: "eq", value: "u1" },
				},
			]),
		);
		const denying = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: ["update", "archive"],
					resource: "post",
					where: { field: "status", op: "eq", value: "archived" },
				},
			]),
		);

		expect(rowsFor(granting, "update")).toEqual(["mine", "archived"]);
		expect(rowsFor(denying, "update")).toEqual(["mine", "theirs"]);
	});
});

describe("a resource", () => {
	it("keeps a condition on its own resource", () => {
		const granting = buildAbility(ac, [
			allow("delete", "post", { where: MINE }),
		]);
		const denying = buildAbility(ac, [
			allow("delete", "comment"),
			deny("delete", "post", { where: ARCHIVED }),
		]);

		expect(granting.can("delete", "comment", comment)).toBe(false);
		expect(denying.can("delete", "comment", comment)).toBe(true);
		expect(denying.where("delete", "comment")).toEqual({ and: [] });
	});
});

describe("a resource nobody declared", () => {
	it("does not compile, and stays apart when it arrives from outside", () => {
		const written = () => [
			// @ts-expect-error nobody declared ghost
			allow("read", "ghost", { where: { id: "x" } }),
		];
		const ability = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: "read",
					resource: "ghost",
					where: { field: "id", op: "eq", value: "p1" },
				},
			]),
		);

		expect(written).toBeTypeOf("function");
		expect(ability.can("read", "ghost" as "post", rows.mine)).toBe(true);
		expect(rowsFor(ability, "read")).toEqual([]);
	});
});

describe("a condition on a field the resource does not declare", () => {
	it("does not compile", () => {
		const written = () => [
			// @ts-expect-error post has no ghost
			allow("update", "post", { where: { ghost: 1 } }),
			// @ts-expect-error body belongs to comment
			deny("update", "post", { where: { body: "x" } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("answers unknown for it when it arrives from outside, so an allow grants nothing and a deny fires", () => {
		const where = { field: "ghost", op: "eq", value: 1 };
		const granting = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "update", resource: "post", where },
			]),
		);
		const denying = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "update", resource: "post" },
				{ effect: "deny", action: "update", resource: "post", where },
			]),
		);

		expect(rowsFor(granting, "update")).toEqual([]);
		expect(rowsFor(denying, "update")).toEqual([]);
	});

	it("reads only the row's own field, never one it inherits", () => {
		const inherited = Object.assign(Object.create({ authorId: "u1" }), {
			id: "p9",
			status: "archived",
			name: "z",
		}) as Post;
		const granting = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
		]);
		const denying = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", { where: { not: MINE } }),
		]);

		expect(granting.can("update", "post", inherited)).toBe(false);
		expect(denying.can("update", "post", inherited)).toBe(false);
		expect(
			compileMatcher(granting.where("update", "post"))(inherited),
		).toBeUndefined();
	});
});

describe("permissions add up", () => {
	it("grants the union of the rows each allow names", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
			allow("update", "post", { where: THEIRS }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "theirs", "archived"]);
		expect(ability.where("update", "post")).toEqual({
			or: [
				{ field: "authorId", op: "eq", value: "u1" },
				{ field: "authorId", op: "eq", value: "u2" },
			],
		});
	});

	it("never narrows an allow with no condition", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
			allow("update", "post"),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "theirs", "archived"]);
		expect(ability.where("update", "post")).toEqual({ and: [] });
		expect(refuses(() => ability.authorize("update", "post"))).toBe(false);
	});

	it("adds up per action without mixing the conditions", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
			allow("delete", "post", { where: THEIRS }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "archived"]);
		expect(rowsFor(ability, "delete")).toEqual(["theirs"]);
	});
});

describe("a deny with a condition takes rows away", () => {
	it("takes its rows away from an allow with no condition", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "theirs"]);
		expect(ability.where("update", "post")).toEqual({
			not: { field: "status", op: "eq", value: "archived" },
		});
	});

	it("takes its rows away from an allow with a condition", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine"]);
	});

	it("loses every row to a deny with no condition", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
			deny("update", "post"),
		]);

		expect(rowsFor(ability, "update")).toEqual([]);
		expect(ability.where("update", "post")).toEqual({ or: [] });
		expect(ability.can("update", "post")).toBe(false);
	});

	it("leaves the rows its condition does not reach", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: MINE }),
			deny("update", "post", { where: THEIRS }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "archived"]);
	});

	it("takes them away wherever it is written", () => {
		const ability = buildAbility(ac, [
			deny("update", "post", { where: ARCHIVED }),
			allow("update", "post", { where: MINE }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine"]);
	});

	it("leaves can open without a row and makes the deciding calls refuse", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(ability.can("update", "post")).toBe(true);
		expect(refuses(() => ability.authorize("update", "post"))).toBe(true);
		expect(ability.canMutate("update", "post")).toBe(false);
	});
});

describe("manage with a condition", () => {
	it("grants every action on its rows, and nothing past them", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post", { where: MINE }),
		]);

		for (const action of ["read", "update", "delete"] as const) {
			expect(rowsFor(ability, action)).toEqual(["mine", "archived"]);
		}

		expect(ability.can("read", "comment", comment)).toBe(false);
	});

	it("loses the rows a deny on one action takes, and only there", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny("delete", "post", { where: ARCHIVED }),
		]);

		expect(rowsFor(ability, "delete")).toEqual(["mine", "theirs"]);
		expect(rowsFor(ability, "update")).toEqual(["mine", "theirs", "archived"]);
	});

	it("loses the rows a deny written as manage takes, from every action", () => {
		const ability = buildAbility(ac, [
			allow(["update", "delete"], "post"),
			deny("manage", "post", { where: ARCHIVED }),
		]);

		expect(rowsFor(ability, "update")).toEqual(["mine", "theirs"]);
		expect(rowsFor(ability, "delete")).toEqual(["mine", "theirs"]);
	});

	it("subtracts a conditional deny from a conditional manage in either order", () => {
		for (const policy of [
			[
				allow("manage", "post", { where: MINE }),
				deny("update", "post", { where: ARCHIVED }),
			],
			[
				deny("update", "post", { where: ARCHIVED }),
				allow("manage", "post", { where: MINE }),
			],
		]) {
			const ability = buildAbility(ac, policy);

			expect(rowsFor(ability, "update")).toEqual(["mine"]);
			expect(rowsFor(ability, "delete")).toEqual(["mine", "archived"]);
		}
	});

	it("selects no row for a question about manage", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post", { where: MINE }),
		]);

		expect(rowsFor(ability, "manage")).toEqual([]);
		expect(ability.can("manage" as "read", "post")).toBe(false);
	});
});

describe("the rule a decision names", () => {
	const watched = (rules: CheckedRule[]) => {
		const seen: Decision[] = [];
		const ability = buildAbility(ac, rules, {
			onDecision: (decision) => {
				seen.push(decision);
			},
		});

		return { ability, seen };
	};

	it("names no rule when a deciding call refuses for want of a row", () => {
		const { ability, seen } = watched([
			allow("update", "post", { where: MINE }),
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(refuses(() => ability.authorize("update", "post"))).toBe(true);
		expect(ability.canMutate("update", "post")).toBe(false);
		expect(seen).toEqual([
			{ action: "update", resource: "post", allowed: false },
			{ action: "update", resource: "post", allowed: false },
		]);
	});

	it("names no rule when only a conditional deny stood in the way", () => {
		const { ability, seen } = watched([
			allow("update", "post"),
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(refuses(() => ability.authorize("update", "post"))).toBe(true);
		expect(seen).toEqual([
			{ action: "update", resource: "post", allowed: false },
		]);
	});

	it("names the deny that fired, with a row or without one", () => {
		const blanket = deny("update", "post");
		const conditional = deny("update", "post", { where: ARCHIVED });
		const withoutRow = watched([allow("update", "post"), blanket]);
		const withRow = watched([allow("update", "post"), conditional]);

		expect(refuses(() => withoutRow.ability.authorize("update", "post"))).toBe(
			true,
		);
		expect(
			refuses(() => withRow.ability.authorize("update", "post", rows.archived)),
		).toBe(true);
		expect(withoutRow.seen).toEqual([
			{ action: "update", resource: "post", allowed: false, rule: blanket },
		]);
		expect(withRow.seen).toEqual([
			{ action: "update", resource: "post", allowed: false, rule: conditional },
		]);
	});

	it("names no rule when the only allow does not hold for the row", () => {
		const { ability, seen } = watched([
			allow("update", "post", { where: MINE }),
		]);

		expect(ability.can("update", "post", rows.theirs)).toBe(false);
		expect(seen).toEqual([
			{ action: "update", resource: "post", allowed: false },
		]);
	});

	it("names the allow behind an optimistic can", () => {
		const permission = allow("update", "post", { where: MINE });
		const { ability, seen } = watched([
			permission,
			deny("update", "post", { where: ARCHIVED }),
		]);

		expect(ability.can("update", "post")).toBe(true);
		expect(seen).toEqual([
			{ action: "update", resource: "post", allowed: true, rule: permission },
		]);
	});
});

describe("a rule on the resource beside a rule on fields, with conditions", () => {
	type Answer = { can: boolean; fields: Field[] };

	const open = (...fields: Field[]): Answer => ({ can: true, fields });
	const closed: Answer = { can: false, fields: [] };
	const ALL: Field[] = ["id", "name", "authorId"];

	const answer = (ability: Ability, action: string, row: Post): Answer => {
		const fields = FIELDS.filter(
			(field) =>
				ability.validatePayload(action, "post", row, { [field]: "x" }).ok,
		);

		expect(ability.permittedFields(action, "post", row, FIELDS)).toEqual(
			fields,
		);

		return { can: ability.can(action, "post", row), fields };
	};

	type Case = {
		name: string;
		rules: CheckedRule[];
		update: { mine: Answer; theirs: Answer };
		read: { mine: Answer; theirs: Answer };
	};

	const nothing = { mine: closed, theirs: closed };

	const cases: Case[] = [
		{
			name: "deny update post where mine + allow update {name}",
			rules: [
				deny("update", "post", { where: MINE }),
				allow("update", { post: ["name"] }),
			],
			update: { mine: closed, theirs: open("name") },
			read: nothing,
		},
		{
			name: "deny update post + allow update {name} where mine",
			rules: [
				deny("update", "post"),
				allow("update", { post: ["name"] }, { where: MINE }),
			],
			update: nothing,
			read: nothing,
		},
		{
			name: "deny update post where mine + allow update {name} where mine",
			rules: [
				deny("update", "post", { where: MINE }),
				allow("update", { post: ["name"] }, { where: MINE }),
			],
			update: nothing,
			read: nothing,
		},
		{
			name: "allow update post where mine + allow update {name}",
			rules: [
				allow("update", "post", { where: MINE }),
				allow("update", { post: ["name"] }),
			],
			update: { mine: open(...ALL), theirs: open("name") },
			read: nothing,
		},
		{
			name: "allow update post + allow update {name} where mine",
			rules: [
				allow("update", "post"),
				allow("update", { post: ["name"] }, { where: MINE }),
			],
			update: { mine: open(...ALL), theirs: open(...ALL) },
			read: nothing,
		},
		{
			name: "allow update post where mine + allow update {name} where mine",
			rules: [
				allow("update", "post", { where: MINE }),
				allow("update", { post: ["name"] }, { where: MINE }),
			],
			update: { mine: open(...ALL), theirs: closed },
			read: nothing,
		},
		{
			name: "allow update post where mine + deny update {authorId}",
			rules: [
				allow("update", "post", { where: MINE }),
				deny("update", { post: ["authorId"] }),
			],
			update: { mine: open("id", "name"), theirs: closed },
			read: nothing,
		},
		{
			name: "allow update post + deny update {authorId} where mine",
			rules: [
				allow("update", "post"),
				deny("update", { post: ["authorId"] }, { where: MINE }),
			],
			update: { mine: open("id", "name"), theirs: open(...ALL) },
			read: nothing,
		},
		{
			name: "allow update post where mine + deny update {authorId} where mine",
			rules: [
				allow("update", "post", { where: MINE }),
				deny("update", { post: ["authorId"] }, { where: MINE }),
			],
			update: { mine: open("id", "name"), theirs: closed },
			read: nothing,
		},
		{
			name: "deny update post where mine + deny update {authorId}",
			rules: [
				deny("update", "post", { where: MINE }),
				deny("update", { post: ["authorId"] }),
			],
			update: nothing,
			read: nothing,
		},
		{
			name: "allow manage post, then deny update post where mine + deny update {authorId}",
			rules: [
				allow("manage", "post"),
				deny("update", "post", { where: MINE }),
				deny("update", { post: ["authorId"] }),
			],
			update: { mine: closed, theirs: open("id", "name") },
			read: { mine: open(...ALL), theirs: open(...ALL) },
		},
		{
			name: "allow manage post, then deny update post + deny update {authorId} where mine",
			rules: [
				allow("manage", "post"),
				deny("update", "post"),
				deny("update", { post: ["authorId"] }, { where: MINE }),
			],
			update: nothing,
			read: { mine: open(...ALL), theirs: open(...ALL) },
		},
		{
			name: "allow manage post, then deny update post where mine + deny update {authorId} where mine",
			rules: [
				allow("manage", "post"),
				deny("update", "post", { where: MINE }),
				deny("update", { post: ["authorId"] }, { where: MINE }),
			],
			update: { mine: closed, theirs: open(...ALL) },
			read: { mine: open(...ALL), theirs: open(...ALL) },
		},
		{
			name: "allow manage post where mine + deny update {authorId}",
			rules: [
				allow("manage", "post", { where: MINE }),
				deny("update", { post: ["authorId"] }),
			],
			update: { mine: open("id", "name"), theirs: closed },
			read: { mine: open(...ALL), theirs: closed },
		},
		{
			name: "deny manage post where mine + allow update {name}",
			rules: [
				deny("manage", "post", { where: MINE }),
				allow("update", { post: ["name"] }),
			],
			update: { mine: closed, theirs: open("name") },
			read: nothing,
		},
		{
			name: "allow update post + deny manage {authorId} where mine",
			rules: [
				allow("update", "post"),
				deny("manage", { post: ["authorId"] }, { where: MINE }),
			],
			update: { mine: open("id", "name"), theirs: open(...ALL) },
			read: nothing,
		},
		{
			name: "allow manage {name} where mine + deny read post",
			rules: [
				allow("manage", { post: ["name"] }, { where: MINE }),
				deny("read", "post"),
			],
			update: { mine: open("name"), theirs: closed },
			read: nothing,
		},
		{
			name: "allow manage post where mine + deny manage {authorId} where mine",
			rules: [
				allow("manage", "post", { where: MINE }),
				deny("manage", { post: ["authorId"] }, { where: MINE }),
			],
			update: { mine: open("id", "name"), theirs: closed },
			read: { mine: open("id", "name"), theirs: closed },
		},
	];

	for (const { name, rules, update, read } of cases) {
		it(`${name}: answers per row for update and read, in either order`, () => {
			for (const policy of [rules, [...rules].reverse()]) {
				const ability = buildAbility(ac, policy);

				expect(answer(ability, "update", rows.mine)).toEqual(update.mine);
				expect(answer(ability, "update", rows.theirs)).toEqual(update.theirs);
				expect(answer(ability, "read", rows.mine)).toEqual(read.mine);
				expect(answer(ability, "read", rows.theirs)).toEqual(read.theirs);
				rowsFor(ability, "update");
				rowsFor(ability, "read");
				expect(ability.can("read", "comment", comment)).toBe(false);
			}
		});
	}
});
