import { describe, expect, it } from "vitest";
import type { Ability } from "../../src/api/index.js";
import { buildAbility } from "../../src/api/index.js";
import { compileMatcher } from "../../src/compile/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { CheckedRule, CheckedRules } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Post = {
	id: string;
	authorId: string;
	status: string;
	title: string;
	views: number;
	tags: string[];
};

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update", "delete"] },
		comment: {
			schema: shape<{ id: string; body: string }>(),
			actions: ["read", "delete"],
		},
	},
});

const { allow, deny } = createRules(ac);

const mine: Post = {
	id: "p1",
	authorId: "u1",
	status: "draft",
	title: "a",
	views: 1,
	tags: [],
};
const theirs: Post = { ...mine, id: "p2", authorId: "u2" };

const MINE = { authorId: "u1" };
const PERMITTED = { status: { in: ["draft", "review"] } };
const FORBIDDEN = { status: "archived" };

const VALUE_NOT_PERMITTED = "value not permitted";
const VALUE_DENIED = "value denied";
const FIELD_NOT_PERMITTED = "field not permitted";

const fromOutside = (json: unknown): CheckedRules => {
	const parsed = parseRules(json);

	if (!parsed.ok) {
		throw new Error(parsed.errors.join("\n"));
	}

	return parsed.rules;
};

const write = (
	ability: Ability,
	data: Partial<Post>,
	row: Post = mine,
	action = "update",
) => ability.validatePayload(action, "post", row, data);

const withoutRow = (ability: Ability, data: Partial<Post>) =>
	ability.validatePayload("update", "post", undefined, data);

const refusal = (...violations: [field: string, reason: string][]) => ({
	ok: false,
	violations: violations.map(([field, reason]) => ({ field, reason })),
});

const VETOED = { ok: false, violations: [] };

describe("one action", () => {
	it("permits the values it names and refuses the rest, field by field", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { values: PERMITTED }),
		]);

		expect(write(ability, { status: "draft" })).toEqual({
			ok: true,
			data: { status: "draft" },
		});
		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { title: "t" }).ok).toBe(true);
		expect(write(ability, {}).ok).toBe(true);
		expect(write(ability, { status: "archived", title: "t" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
	});

	it("never touches the row", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { values: PERMITTED }),
		]);

		expect(ability.can("update", "post", mine)).toBe(true);
		expect(ability.can("update", "post")).toBe(true);
		expect(() => ability.authorize("update", "post")).not.toThrow();
		expect(ability.canMutate("update", "post")).toBe(true);
		expect(ability.where("update", "post")).toEqual({ and: [] });
		expect(
			ability.permittedFields("update", "post", mine, ["status", "title"]),
		).toEqual(["status", "title"]);
	});

	it("takes a value away with a deny and leaves the row open", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
		expect(write(ability, { status: "published" }).ok).toBe(true);
		expect(ability.can("update", "post", mine)).toBe(true);
		expect(ability.where("update", "post")).toEqual({ and: [] });
		expect(() => ability.authorize("update", "post")).not.toThrow();
	});

	it("grants nothing when only a deny carries values", () => {
		const ability = buildAbility(ac, [
			deny("update", "post", { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "draft" })).toEqual(VETOED);
		expect(ability.can("update", "post", mine)).toBe(false);
	});

	it("on read, leaves the rows whole", () => {
		const ability = buildAbility(ac, [
			allow("read", "post", { values: PERMITTED }),
		]);

		expect(ability.can("read", "post", { ...mine, status: "archived" })).toBe(
			true,
		);
		expect(ability.where("read", "post")).toEqual({ and: [] });
	});
});

describe("a list of actions", () => {
	it("constrains every action in the list, and only those", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], "post", { values: PERMITTED }),
		]);

		for (const action of ["read", "update"]) {
			expect(write(ability, { status: "archived" }, mine, action)).toEqual(
				refusal(["status", VALUE_NOT_PERMITTED]),
			);
		}

		expect(write(ability, { status: "draft" }, mine, "delete")).toEqual(VETOED);
	});

	it("takes the value away from every action a deny lists", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny(["read", "update"], "post", { values: FORBIDDEN }),
		]);

		for (const action of ["read", "update"]) {
			expect(write(ability, { status: "archived" }, mine, action)).toEqual(
				refusal(["status", VALUE_DENIED]),
			);
		}

		expect(write(ability, { status: "archived" }, mine, "delete").ok).toBe(
			true,
		);
	});
});

describe("names nobody declared", () => {
	it("do not compile", () => {
		const written = () => [
			// @ts-expect-error post declares no archive
			allow("archive", "post", { values: PERMITTED }),
			// @ts-expect-error nobody declared ghost
			deny("update", "ghost", { values: FORBIDDEN }),
			// @ts-expect-error post has no ghost field
			allow("update", "post", { values: { ghost: 1 } }),
			// @ts-expect-error nor may a deny constrain one
			deny("update", "post", { values: { ghost: 1 } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("mean only themselves when they arrive from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: "update",
					resource: "post",
					values: { field: "ghost", op: "eq", value: 2 },
				},
			]),
		);

		expect(write(ability, { ghost: 1 } as Partial<Post>)).toEqual(
			refusal(["ghost", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { ghost: 2 } as Partial<Post>).ok).toBe(true);
		expect(write(ability, { status: "anything" }).ok).toBe(true);
	});
});

describe("the field a value constraint stands on", () => {
	it("must be named by a permission's target", () => {
		const written = () =>
			// @ts-expect-error a permission's values stand on the fields it names
			allow("update", { post: ["title"] }, { values: { status: "draft" } });

		expect(written).toBeTypeOf("function");
	});

	it("may stand anywhere on a prohibition, and still takes the value away", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", { post: ["title"] }, { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
		expect(write(ability, { title: "t" })).toEqual(
			refusal(["title", FIELD_NOT_PERMITTED]),
		);
		expect(write(ability, { status: "draft" }).ok).toBe(true);
	});

	it("is not reached when the field itself is not permitted", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["title"] }),
			deny("update", "post", { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", FIELD_NOT_PERMITTED]),
		);
	});
});

describe("the shape of a value constraint", () => {
	it("stays flat in the types", () => {
		const written = () => [
			// @ts-expect-error values take no or
			allow("update", "post", { values: { or: [{ status: "draft" }] } }),
			// @ts-expect-error nor a not
			deny("update", "post", { values: { not: { status: "draft" } } }),
			// @ts-expect-error nor nothing at all
			allow("update", "post", { values: {} }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("offers each field only the operators its type can answer", () => {
		const written = () => [
			// @ts-expect-error a string is not ordered in values
			allow("update", "post", { values: { title: { gt: "a" } } }),
			// @ts-expect-error a number holds no substring
			allow("update", "post", { values: { views: { contains: "1" } } }),
			// @ts-expect-error a scalar is not an array
			allow("update", "post", { values: { status: { has: "x" } } }),
			// @ts-expect-error an array is never compared whole
			allow("update", "post", { values: { tags: ["x"] } }),
			// @ts-expect-error a number is ordered against a number
			allow("update", "post", { values: { views: { gt: "1" } } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("is refused when it arrives from outside in any other form", () => {
		const refused: [values: unknown, message: string][] = [
			[{ or: [{ field: "status", op: "eq", value: "draft" }] }, '"or"'],
			[{ not: { field: "status", op: "eq", value: "draft" } }, '"not"'],
			[
				{
					relation: "author",
					type: "one",
					where: { field: "id", op: "eq", value: "u1" },
				},
				'"relation"',
			],
			[{ and: [] }, "expected at least one condition"],
			[
				{
					and: [{ field: "status", op: "eq", value: "draft" }],
					field: "status",
					op: "eq",
					value: "x",
				},
				"exactly one shape",
			],
			[
				{ field: "status", op: "in", value: "draft" },
				'expected an array for "in"',
			],
			[
				{ field: "title", op: "contains", value: 5 },
				'expected a string for "contains"',
			],
			[
				{ field: "views", op: "gt", value: null },
				'expected a number or a string for "gt"',
			],
			[{ field: "status", op: "like", value: "d" }, 'unknown operator "like"'],
		];

		for (const [values, message] of refused) {
			const parsed = parseRules([
				{ effect: "deny", action: "update", resource: "post", values },
			]);

			expect(parsed.ok).toBe(false);
			expect(parsed.ok || parsed.errors.join("\n")).toContain(message);
		}
	});
});

describe("permissions add up", () => {
	it("permits a value any allow permits", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { values: PERMITTED }),
			allow("update", "post", { values: { status: "published" } }),
		]);

		expect(write(ability, { status: "review" }).ok).toBe(true);
		expect(write(ability, { status: "published" }).ok).toBe(true);
		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
	});

	it("frees a field another allow permits without a constraint", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { values: PERMITTED }),
			allow("update", { post: ["status"] }),
		]);

		expect(write(ability, { status: "archived" }).ok).toBe(true);
	});

	it("keeps a field constrained when the other allow names other fields", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["status"] }, { values: PERMITTED }),
			allow("update", { post: ["title"] }),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { title: "t" }).ok).toBe(true);
	});

	it("adds up per action without mixing the constraints", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { values: PERMITTED }),
			allow("delete", "post", { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { status: "archived" }, mine, "delete").ok).toBe(
			true,
		);
		expect(write(ability, { status: "draft" }, mine, "delete")).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
	});
});

describe("a deny takes values away", () => {
	it("beats an allow that permits the same value, and says so", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", {
				values: { status: { in: ["draft", "archived"] } },
			}),
			deny("update", "post", { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
		expect(write(ability, { status: "draft" }).ok).toBe(true);
	});

	it("gives way to a deny of the field itself", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", { post: ["status"] }),
			deny("update", "post", { values: FORBIDDEN }),
		]);

		for (const status of ["archived", "draft"]) {
			expect(write(ability, { status })).toEqual(
				refusal(["status", FIELD_NOT_PERMITTED]),
			);
		}
	});

	it("subtracts a field it names whatever the value", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", { post: ["status"] }, { values: FORBIDDEN }),
		]);

		expect(write(ability, { status: "draft" })).toEqual(
			refusal(["status", FIELD_NOT_PERMITTED]),
		);
		expect(write(ability, { title: "t" }).ok).toBe(true);
	});

	it("takes it away wherever it is written", () => {
		const ability = buildAbility(ac, [
			deny("update", "post", { values: FORBIDDEN }),
			allow("update", "post", {
				values: { status: { in: ["draft", "archived"] } },
			}),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
	});
});

describe("several constraints in one rule", () => {
	it("judges each field by its own constraint", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", {
				values: { status: "draft", views: { lte: 10 } },
			}),
		]);

		expect(write(ability, { status: "draft", views: 50 })).toEqual(
			refusal(["views", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { status: "archived", views: 5 })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { status: "archived", views: 50 })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED], ["views", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { status: "draft", views: 5 }).ok).toBe(true);
	});

	it("requires every constraint an and puts on one field", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", {
				values: { and: [{ views: { gte: 0 } }, { views: { lte: 10 } }] },
			}),
		]);

		expect(write(ability, { views: 5 }).ok).toBe(true);
		expect(write(ability, { views: 11 })).toEqual(
			refusal(["views", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { views: -1 })).toEqual(
			refusal(["views", VALUE_NOT_PERMITTED]),
		);
	});

	it("takes a value away only when every constraint an and puts on one field holds", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", {
				values: { and: [{ views: { gte: 10 } }, { views: { lte: 100 } }] },
			}),
		]);

		expect(write(ability, { views: 50 })).toEqual(
			refusal(["views", VALUE_DENIED]),
		);
		expect(write(ability, { views: 5 }).ok).toBe(true);
		expect(write(ability, { views: 500 }).ok).toBe(true);
	});

	it("subtracts a field a deny both names and constrains, whatever the value", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", { post: ["status"] }, { values: { status: "archived" } }),
		]);

		for (const status of ["archived", "draft"]) {
			expect(write(ability, { status })).toEqual(
				refusal(["status", FIELD_NOT_PERMITTED]),
			);
		}

		expect(write(ability, { title: "t" }).ok).toBe(true);
	});

	it("subtracts each field a deny constrains, on its own", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", {
				values: { status: "archived", views: { gt: 100 } },
			}),
		]);

		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
		expect(write(ability, { views: 200 })).toEqual(
			refusal(["views", VALUE_DENIED]),
		);
		expect(write(ability, { status: "draft", views: 5 }).ok).toBe(true);
	});
});

describe("values with a condition", () => {
	it("constrains the rows its condition holds for", () => {
		const granting = buildAbility(ac, [
			allow("update", "post", { where: MINE, values: PERMITTED }),
		]);
		const denying = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", { where: MINE, values: FORBIDDEN }),
		]);

		expect(write(granting, { status: "archived" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
		expect(write(granting, { status: "draft" }, theirs)).toEqual(VETOED);
		expect(write(denying, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
		expect(write(denying, { status: "archived" }, theirs).ok).toBe(true);
	});

	it("without a row, lets no conditional allow grant and no conditional deny be passed", () => {
		const granting = buildAbility(ac, [
			allow("update", "post", { where: MINE, values: PERMITTED }),
		]);
		const denying = buildAbility(ac, [
			allow("update", "post"),
			deny("update", "post", { where: MINE, values: FORBIDDEN }),
		]);

		expect(withoutRow(granting, { status: "draft" })).toEqual(VETOED);
		expect(withoutRow(denying, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
		expect(withoutRow(denying, { status: "draft" }).ok).toBe(true);
	});

	it("without a row, names the permission's refusal over a conditional deny it could not settle", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { values: PERMITTED }),
			deny("update", "post", { where: MINE, values: FORBIDDEN }),
		]);

		expect(withoutRow(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_NOT_PERMITTED]),
		);
		expect(write(ability, { status: "archived" })).toEqual(
			refusal(["status", VALUE_DENIED]),
		);
	});
});

describe("manage", () => {
	it("carries its values to every action, and only on its resource", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post", { values: PERMITTED }),
		]);

		for (const action of ["read", "update", "delete"]) {
			expect(write(ability, { status: "archived" }, mine, action)).toEqual(
				refusal(["status", VALUE_NOT_PERMITTED]),
			);
		}

		expect(
			ability.validatePayload(
				"delete",
				"comment",
				{ id: "c1", body: "b" },
				{
					body: "x",
				},
			),
		).toEqual(VETOED);
	});

	it("writes nothing for a question about manage", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post", { values: PERMITTED }),
		]);

		expect(write(ability, { status: "draft" }, mine, "manage")).toEqual(VETOED);
	});
});

describe("every permission against every prohibition, with manage anywhere, on every row", () => {
	type Outcome = "ok" | "field" | "value" | "denied" | "vetoed";
	type Payload = "draft" | "archived" | "title" | "id";
	type Writes = Record<Payload, Outcome>;
	type Action = "update" | "manage";

	const PAYLOADS: Record<Payload, Partial<Post>> = {
		draft: { status: "draft" },
		archived: { status: "archived" },
		title: { title: "t" },
		id: { id: "x" },
	};

	const REASONS: Record<string, Outcome> = {
		[FIELD_NOT_PERMITTED]: "field",
		[VALUE_NOT_PERMITTED]: "value",
		[VALUE_DENIED]: "denied",
	};

	const outcomeOf = (
		ability: Ability,
		action: string,
		row: Post | undefined,
		data: Partial<Post>,
	): Outcome => {
		const result = ability.validatePayload(action, "post", row, data);

		if (result.ok) {
			return "ok";
		}

		const [first] = result.violations;

		return first === undefined ? "vetoed" : (REASONS[first.reason] ?? "vetoed");
	};

	type Permission = {
		name: string;
		rule: (action: Action) => CheckedRule;
		isConditional: boolean;
		writes: Writes;
	};
	type Prohibition = {
		name: string;
		rule?: (action: Action) => CheckedRule;
		isConditional: boolean;
		vetoes: boolean;
		takes: Partial<Writes>;
	};

	const permissions: Permission[] = [
		{
			name: "allow post",
			rule: (action) => allow(action, "post"),
			isConditional: false,
			writes: { draft: "ok", archived: "ok", title: "ok", id: "ok" },
		},
		{
			name: "allow {status, title}",
			rule: (action) => allow(action, { post: ["status", "title"] }),
			isConditional: false,
			writes: { draft: "ok", archived: "ok", title: "ok", id: "field" },
		},
		{
			name: "allow post with values",
			rule: (action) => allow(action, "post", { values: PERMITTED }),
			isConditional: false,
			writes: { draft: "ok", archived: "value", title: "ok", id: "ok" },
		},
		{
			name: "allow {status, title} with values",
			rule: (action) =>
				allow(action, { post: ["status", "title"] }, { values: PERMITTED }),
			isConditional: false,
			writes: { draft: "ok", archived: "value", title: "ok", id: "field" },
		},
		{
			name: "allow {status, title} with values where mine",
			rule: (action) =>
				allow(
					action,
					{ post: ["status", "title"] },
					{ where: MINE, values: PERMITTED },
				),
			isConditional: true,
			writes: { draft: "ok", archived: "value", title: "ok", id: "field" },
		},
	];

	const prohibitions: Prohibition[] = [
		{ name: "no deny", isConditional: false, vetoes: false, takes: {} },
		{
			name: "deny post",
			rule: (action) => deny(action, "post"),
			isConditional: false,
			vetoes: true,
			takes: {},
		},
		{
			name: "deny {title}",
			rule: (action) => deny(action, { post: ["title"] }),
			isConditional: false,
			vetoes: false,
			takes: { title: "field" },
		},
		{
			name: "deny values",
			rule: (action) => deny(action, "post", { values: FORBIDDEN }),
			isConditional: false,
			vetoes: false,
			takes: { archived: "denied" },
		},
		{
			name: "deny {title} with values",
			rule: (action) =>
				deny(action, { post: ["title"] }, { values: FORBIDDEN }),
			isConditional: false,
			vetoes: false,
			takes: { title: "field", archived: "denied" },
		},
		{
			name: "deny post where mine",
			rule: (action) => deny(action, "post", { where: MINE }),
			isConditional: true,
			vetoes: true,
			takes: {},
		},
		{
			name: "deny values where mine",
			rule: (action) =>
				deny(action, "post", { where: MINE, values: FORBIDDEN }),
			isConditional: true,
			vetoes: false,
			takes: { archived: "denied" },
		},
		{
			name: "deny {title} where mine",
			rule: (action) => deny(action, { post: ["title"] }, { where: MINE }),
			isConditional: true,
			vetoes: false,
			takes: { title: "field" },
		},
		{
			name: "deny {title} with values where mine",
			rule: (action) =>
				deny(action, { post: ["title"] }, { where: MINE, values: FORBIDDEN }),
			isConditional: true,
			vetoes: false,
			takes: { title: "field", archived: "denied" },
		},
	];

	type Place = "mine" | "theirs" | "no row";

	const ROWS: Record<Place, Post | undefined> = {
		mine,
		theirs,
		"no row": undefined,
	};

	const permissionApplies = (permission: Permission, place: Place) =>
		!permission.isConditional || place === "mine";

	const prohibitionApplies = (prohibition: Prohibition, place: Place) =>
		prohibition.rule !== undefined &&
		(!prohibition.isConditional || place !== "theirs");

	const VETO: Writes = {
		draft: "vetoed",
		archived: "vetoed",
		title: "vetoed",
		id: "vetoed",
	};

	const expected = (
		permission: Permission,
		prohibition: Prohibition,
		place: Place,
		allowReaches: boolean,
		denyReaches: boolean,
	): Writes => {
		if (!allowReaches || !permissionApplies(permission, place)) {
			return VETO;
		}

		const denies = denyReaches && prohibitionApplies(prohibition, place);

		if (denies && prohibition.vetoes) {
			return VETO;
		}

		const isUndecided = place === "no row" && prohibition.isConditional;
		const writes = { ...permission.writes };

		for (const payload of Object.keys(writes) as Payload[]) {
			const taken = denies ? prohibition.takes[payload] : undefined;
			const isSettledRefusal = isUndecided && writes[payload] === "value";

			if (
				writes[payload] !== "field" &&
				taken !== undefined &&
				!isSettledRefusal
			) {
				writes[payload] = taken;
			}
		}

		return writes;
	};

	const placements: [name: string, allowAction: Action, denyAction: Action][] =
		[
			["no manage", "update", "update"],
			["manage on the allow", "manage", "update"],
			["manage on the deny", "update", "manage"],
			["manage on both", "manage", "manage"],
		];

	for (const permission of permissions) {
		for (const prohibition of prohibitions) {
			it(`${permission.name} against ${prohibition.name}`, () => {
				for (const [placement, allowAction, denyAction] of placements) {
					const rules = [
						permission.rule(allowAction),
						...(prohibition.rule === undefined
							? []
							: [prohibition.rule(denyAction)]),
					];

					for (const policy of [rules, [...rules].reverse()]) {
						const ability = buildAbility(ac, policy);

						for (const action of ["update", "read"] as const) {
							const allowReaches =
								action === "update" || allowAction === "manage";
							const denyReaches =
								action === "update" || denyAction === "manage";

							for (const place of ["mine", "theirs", "no row"] as const) {
								const row = ROWS[place];
								const want = expected(
									permission,
									prohibition,
									place,
									allowReaches,
									denyReaches,
								);
								const got = Object.fromEntries(
									(Object.keys(PAYLOADS) as Payload[]).map((payload) => [
										payload,
										outcomeOf(ability, action, row, PAYLOADS[payload]),
									]),
								);

								expect({ placement, action, place, got }).toEqual({
									placement,
									action,
									place,
									got: want,
								});

								if (row !== undefined) {
									const isOpen = want.draft !== "vetoed";

									expect(ability.can(action, "post", row)).toBe(isOpen);
									expect(
										compileMatcher(ability.where(action, "post"))(row) === true,
									).toBe(isOpen);
									expect(
										ability.permittedFields(action, "post", row, [
											"status",
											"title",
											"id",
										]),
									).toEqual(
										(["status", "title", "id"] as const).filter((field) => {
											const outcome =
												want[field === "status" ? "draft" : field];

											return outcome !== "field" && outcome !== "vetoed";
										}),
									);
								}
							}
						}
					}
				}
			});
		}
	}
});
