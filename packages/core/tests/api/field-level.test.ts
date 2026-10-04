import { describe, expect, it } from "vitest";
import type { Ability } from "../../src/api/index.js";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { ForbiddenError } from "../../src/errors/index.js";
import type { CheckedRules, Rule } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

const secret = Symbol("secret");

type Post = { id: string; name: string; authorId: string };
type Comment = { id: string; body: string };
type Sheet = { 0: string; [secret]: string; "": string; title: string };
type Field = keyof Post;

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update", "delete"] },
		comment: { schema: shape<Comment>(), actions: ["read", "delete"] },
		sheet: { schema: shape<Sheet>(), actions: ["update"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = { id: "p1", name: "first", authorId: "u1" };
const comment: Comment = { id: "c1", body: "hi" };
const sheet: Sheet = { 0: "a", [secret]: "b", "": "c", title: "t" };
const FIELDS: Field[] = ["id", "name", "authorId"];

const fromOutside = (json: unknown): CheckedRules => {
	const parsed = parseRules(json);

	if (!parsed.ok) {
		throw new Error(parsed.errors.join("\n"));
	}

	return parsed.rules;
};

const fieldsOf = (ability: Ability, action: string) => ({
	offered: ability.permittedFields(action, "post", post, FIELDS),
	written: FIELDS.filter(
		(field) =>
			ability.validatePayload(action, "post", post, { [field]: "x" }).ok,
	),
	writtenWithoutRow: FIELDS.filter(
		(field) =>
			ability.validatePayload(action, "post", undefined, { [field]: "x" }).ok,
	),
});

const only = (...fields: Field[]) => ({
	offered: fields,
	written: fields,
	writtenWithoutRow: fields,
});

const rowsOf = (ability: Ability, action: string) => ({
	can: ability.can(action, "post", post),
	where: ability.where(action, "post"),
});

const EVERY_ROW = { can: true, where: { and: [] } };
const NO_ROW = { can: false, where: { or: [] } };

describe("one action", () => {
	it("writes the fields it names, and only those", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["id", "name"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
	});

	it("opens every row, and the deciding calls say so without a row", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["id", "name"] }),
		]);

		expect(rowsOf(ability, "update")).toEqual(EVERY_ROW);
		expect(() => ability.authorize("update", "post")).not.toThrow();
		expect(ability.canMutate("update", "post")).toBe(true);
	});

	it("grants nothing on another action", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["id", "name"] }),
		]);

		expect(fieldsOf(ability, "delete")).toEqual(only());
		expect(rowsOf(ability, "delete")).toEqual(NO_ROW);
	});

	it("grants nothing when only a deny names fields", () => {
		const ability = buildAbility(ac, [deny("update", { post: ["name"] })]);

		expect(fieldsOf(ability, "update")).toEqual(only());
		expect(rowsOf(ability, "update")).toEqual(NO_ROW);
		expect(() => ability.authorize("update", "post")).toThrow(ForbiddenError);
		expect(ability.canMutate("update", "post")).toBe(false);
	});

	it("on read, opens the rows whole and names its fields only to permittedFields", () => {
		const ability = buildAbility(ac, [allow("read", { post: ["id", "name"] })]);

		expect(rowsOf(ability, "read")).toEqual(EVERY_ROW);
		expect(ability.permittedFields("read", "post", post, FIELDS)).toEqual([
			"id",
			"name",
		]);
	});
});

describe("a list of actions", () => {
	it("gives its fields to every action in the list, and only to those", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update"], { post: ["name"] }),
		]);

		expect(fieldsOf(ability, "read")).toEqual(only("name"));
		expect(fieldsOf(ability, "update")).toEqual(only("name"));
		expect(fieldsOf(ability, "delete")).toEqual(only());
	});

	it("takes its fields away from every action a deny lists", () => {
		const ability = buildAbility(ac, [
			allow(["read", "update", "delete"], "post"),
			deny(["read", "update"], { post: ["authorId"] }),
		]);

		expect(fieldsOf(ability, "read")).toEqual(only("id", "name"));
		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
		expect(fieldsOf(ability, "delete")).toEqual(only("id", "name", "authorId"));
	});
});

describe("an action the resource does not declare", () => {
	it("does not compile in a rule", () => {
		const written = () => [
			// @ts-expect-error post declares no archive
			allow("archive", { post: ["name"] }),
			// @ts-expect-error nor does a deny get to name it
			deny("archive", { post: ["name"] }),
			// @ts-expect-error update is declared on post, not on comment
			allow("update", { comment: ["body"] }),
			// @ts-expect-error nor for a deny
			deny("update", { comment: ["body"] }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("does not compile in a question", () => {
		const ability = buildAbility(ac, [allow("update", { post: ["name"] })]);
		const asked = () => [
			// @ts-expect-error post declares no archive
			ability.permittedFields("archive", "post", post, ["name"]),
			// @ts-expect-error nor may a write ask about it
			ability.validatePayload("archive", "post", post, { name: "x" }),
		];

		expect(asked).toBeTypeOf("function");
	});

	it("writes nothing when asked anyway", () => {
		const ability = buildAbility(ac, [allow("update", { post: ["name"] })]);

		expect(fieldsOf(ability, "archive")).toEqual(only());
	});

	it("gives its fields only to its own name when it arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: "archive",
					resource: "post",
					fields: ["name"],
				},
			]),
		);

		expect(fieldsOf(ability, "archive")).toEqual(only("name"));
		expect(fieldsOf(ability, "update")).toEqual(only());
	});
});

describe("an empty list of actions", () => {
	it("does not compile", () => {
		const written = () => [
			// @ts-expect-error a rule names at least one action
			allow([], { post: ["name"] }),
			// @ts-expect-error a deny naming none protects nothing
			deny([], { post: ["name"] }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("is refused when a rule arrives from outside", () => {
		expect(
			parseRules([
				{ effect: "deny", action: [], resource: "post", fields: ["name"] },
			]).ok,
		).toBe(false);
	});
});

describe("an undeclared action inside a list", () => {
	it("does not compile", () => {
		const written = () => [
			// @ts-expect-error post declares no archive
			allow(["update", "archive"], { post: ["name"] }),
			// @ts-expect-error nor does a deny list get to name it
			deny(["update", "archive"], { post: ["name"] }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("keeps the declared names when an allow list arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: ["update", "archive"],
					resource: "post",
					fields: ["name"],
				},
			]),
		);

		expect(fieldsOf(ability, "update")).toEqual(only("name"));
		expect(fieldsOf(ability, "archive")).toEqual(only("name"));
		expect(fieldsOf(ability, "delete")).toEqual(only());
	});

	it("still takes the fields away when a deny list arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: ["update", "archive"],
					resource: "post",
					fields: ["authorId"],
				},
			]),
		);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
	});
});

describe("a resource", () => {
	it("keeps its fields on its own resource", () => {
		const ability = buildAbility(ac, [allow("delete", { post: ["name"] })]);

		expect(
			ability.permittedFields("delete", "comment", comment, ["id", "body"]),
		).toEqual([]);
		expect(ability.can("delete", "comment", comment)).toBe(false);
	});

	it("keeps a field deny on its own resource", () => {
		const ability = buildAbility(ac, [
			allow("delete", "post"),
			allow("delete", "comment"),
			deny("delete", { post: ["id"] }),
		]);

		expect(fieldsOf(ability, "delete")).toEqual(only("name", "authorId"));
		expect(
			ability.permittedFields("delete", "comment", comment, ["id", "body"]),
		).toEqual(["id", "body"]);
	});

	it("does not compile when a target names two resources", () => {
		const written = () => [
			// @ts-expect-error a rule names one resource
			allow("delete", { post: ["id"], comment: ["body"] }),
			// @ts-expect-error nor may a deny name two
			deny("delete", { post: ["id"], comment: ["body"] }),
		];

		expect(written).toBeTypeOf("function");
	});
});

describe("a resource nobody declared", () => {
	it("does not compile in a rule", () => {
		const written = () => [
			// @ts-expect-error nobody declared ghost
			allow("read", { ghost: ["id"] }),
			// @ts-expect-error nor may a deny name it
			deny("read", { ghost: ["id"] }),
			// @ts-expect-error manage does not make ghost a resource
			allow("manage", { ghost: ["id"] }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("stays apart when a rule for it arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "read", resource: "ghost", fields: ["id"] },
			]),
		);

		expect(
			ability.permittedFields("read", "ghost" as "post", post, FIELDS),
		).toEqual(["id"]);
		expect(fieldsOf(ability, "read")).toEqual(only());
	});
});

describe("a field the resource does not declare", () => {
	it("does not compile in a rule", () => {
		const written = () => [
			// @ts-expect-error post has no ghost
			allow("update", { post: ["ghost"] }),
			// @ts-expect-error nor may a deny name it
			deny("update", { post: ["ghost"] }),
			// @ts-expect-error one unknown name spoils the list
			allow("update", { post: ["name", "ghost"] }),
			// @ts-expect-error body belongs to comment, not to post
			allow("delete", { post: ["body"] }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("does not compile in a question", () => {
		const ability = buildAbility(ac, [allow("update", { post: ["name"] })]);
		const asked = () => [
			// @ts-expect-error post has no ghost
			ability.permittedFields("update", "post", post, ["ghost"]),
			// @ts-expect-error nor may a write carry it
			ability.validatePayload("update", "post", post, { ghost: "x" }),
		];

		expect(asked).toBeTypeOf("function");
	});

	it("is refused in a write under a permission that names fields", () => {
		const ability = buildAbility(ac, [allow("update", { post: ["name"] })]);

		expect(
			ability.validatePayload("update", "post", post, {
				name: "x",
				ghost: "x",
			} as Partial<Post>),
		).toEqual({
			ok: false,
			violations: [{ field: "ghost", reason: "field not permitted" }],
		});
	});

	it("means only itself when a rule arrives from outside", () => {
		const granted = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: "update",
					resource: "post",
					fields: ["ghost", "name"],
				},
			]),
		);
		const denied = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "update", resource: "post" },
				{
					effect: "deny",
					action: "update",
					resource: "post",
					fields: ["ghost", "name"],
				},
			]),
		);

		expect(fieldsOf(granted, "update")).toEqual(only("name"));
		expect(fieldsOf(denied, "update")).toEqual(only("id", "authorId"));
	});
});

describe("an empty list of fields", () => {
	it("does not compile", () => {
		const written = () => [
			// @ts-expect-error a field list names at least one field
			allow("update", { post: [] }),
			// @ts-expect-error a deny naming none protects nothing
			deny("update", { post: [] }),
			{
				effect: "allow",
				action: "read",
				resource: "post",
				// @ts-expect-error nor may a rule written as data
				fields: [],
			} satisfies Rule<Post>,
		];

		expect(written).toBeTypeOf("function");
	});

	it("is refused when a rule arrives from outside", () => {
		expect(
			parseRules([
				{ effect: "deny", action: "update", resource: "post", fields: [] },
			]),
		).toEqual({
			ok: false,
			errors: [
				"rules[0].fields: expected at least one field name — naming none says nothing about a write",
			],
		});
	});
});

describe("fields written as numbers or symbols", () => {
	it("does not compile in a rule, even when the schema has such a key", () => {
		const written = () => [
			// @ts-expect-error a numeric key is not a field a rule can name
			allow("update", { sheet: [0] }),
			// @ts-expect-error nor may a deny name it
			deny("update", { sheet: [0] }),
			// @ts-expect-error a symbol key is not a field a rule can name
			allow("update", { sheet: [secret] }),
			// @ts-expect-error nor may a deny name it
			deny("update", { sheet: [secret] }),
			{
				effect: "allow",
				action: "update",
				resource: "sheet",
				// @ts-expect-error nor may a rule written as data
				fields: [0],
			} satisfies Rule<Sheet>,
		];

		expect(written).toBeTypeOf("function");
		expect(allow("update", { sheet: ["title"] }).fields).toEqual(["title"]);
	});

	it("does not compile in a question", () => {
		const ability = buildAbility(ac, [allow("update", "sheet")]);
		const asked = () => [
			// @ts-expect-error a numeric key is not a field a question can name
			ability.permittedFields("update", "sheet", sheet, [0]),
			// @ts-expect-error nor is a symbol key
			ability.permittedFields("update", "sheet", sheet, [secret]),
		];

		expect(asked).toBeTypeOf("function");
	});

	it("is refused when a rule arrives from outside", () => {
		for (const field of [1, secret]) {
			expect(
				parseRules([
					{
						effect: "allow",
						action: "update",
						resource: "post",
						fields: ["name", field],
					},
				]),
			).toEqual({
				ok: false,
				errors: ["rules[0].fields: expected an array of strings"],
			});
		}
	});

	it("judges a numeric key in a write as the string it is", () => {
		const ability = buildAbility(ac, [allow("update", { post: ["name"] })]);

		expect(
			ability.validatePayload("update", "post", post, {
				0: "x",
			} as Partial<Post>),
		).toEqual({
			ok: false,
			violations: [{ field: "0", reason: "field not permitted" }],
		});
	});
});

describe("a field named like what every object inherits", () => {
	it("is refused in a write, offered to no form and polluting nothing, whatever the rules name", () => {
		const PROTO_KEYS = ["__proto__", "constructor", "prototype"];
		const data = JSON.parse(
			'{"__proto__": {"isAdmin": true}, "constructor": {"prototype": {"polluted": true}}, "prototype": 3, "name": "x"}',
		);
		const refusal = {
			ok: false,
			violations: PROTO_KEYS.map((field) => ({
				field,
				reason: "field not permitted",
			})),
		};
		const whole = buildAbility(ac, [allow("update", "post")]);
		const naming = buildAbility(
			ac,
			fromOutside([
				{
					effect: "allow",
					action: "update",
					resource: "post",
					fields: [...PROTO_KEYS, "name"],
				},
			]),
		);

		for (const ability of [whole, naming]) {
			expect(ability.validatePayload("update", "post", post, data)).toEqual(
				refusal,
			);
			expect(
				ability.permittedFields("update", "post", post, [
					...PROTO_KEYS,
					"name",
				] as Field[]),
			).toEqual(["name"]);
		}

		expect(Object.prototype).not.toHaveProperty("isAdmin");
		expect(Object.prototype).not.toHaveProperty("polluted");
	});
});

describe("an empty field name", () => {
	it("does not compile, even when the schema has such a key", () => {
		const ability = buildAbility(ac, [allow("update", "sheet")]);
		const written = () => [
			// @ts-expect-error an empty key is not a field a rule can name
			allow("update", { sheet: [""] }),
			// @ts-expect-error nor may a deny name it
			deny("update", { sheet: [""] }),
			{
				effect: "allow",
				action: "update",
				resource: "sheet",
				// @ts-expect-error nor may a rule written as data
				fields: [""],
			} satisfies Rule<Sheet>,
			// @ts-expect-error nor may a question
			ability.permittedFields("update", "sheet", sheet, [""]),
		];

		expect(written).toBeTypeOf("function");
	});

	it("is refused when a rule arrives from outside", () => {
		for (const fields of [[""], ["name", ""]]) {
			expect(
				parseRules([
					{ effect: "deny", action: "update", resource: "post", fields },
				]),
			).toEqual({
				ok: false,
				errors: [
					"rules[0].fields: expected a field name — an empty key is not a field a rule can name",
				],
			});
		}
	});
});

describe("permissions add up", () => {
	it("writes the union of the fields each allow names", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["id"] }),
			allow("update", { post: ["name"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
	});

	it("never narrows an allow that names no fields", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["name"] }),
			allow("update", "post"),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name", "authorId"));
	});

	it("adds up per action without mixing them", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["name"] }),
			allow("delete", { post: ["authorId"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("name"));
		expect(fieldsOf(ability, "delete")).toEqual(only("authorId"));
	});

	it("lets one deny take away a field granted twice", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["name"] }),
			allow("update", { post: ["id", "name"] }),
			deny("update", { post: ["name"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id"));
	});
});

describe("a deny takes fields away", () => {
	it("takes the field away and leaves the row open", () => {
		const ability = buildAbility(ac, [
			allow("update", "post"),
			deny("update", { post: ["authorId"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
		expect(rowsOf(ability, "update")).toEqual(EVERY_ROW);
		expect(() => ability.authorize("update", "post")).not.toThrow();
		expect(ability.canMutate("update", "post")).toBe(true);
	});

	it("takes it away wherever it is written", () => {
		const ability = buildAbility(ac, [
			deny("update", { post: ["authorId"] }),
			allow("update", "post"),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
	});

	it("takes a field away from an allow that names it", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["id", "name"] }),
			deny("update", { post: ["name"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id"));
	});

	it("leaves the other fields when it names one nobody granted", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["id", "name"] }),
			deny("update", { post: ["authorId"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
	});

	it("loses every field to a deny that names none", () => {
		const ability = buildAbility(ac, [
			allow("update", { post: ["name"] }),
			deny("update", "post"),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only());
		expect(rowsOf(ability, "update")).toEqual(NO_ROW);
		expect(() => ability.authorize("update", "post")).toThrow(ForbiddenError);
		expect(
			ability.validatePayload("update", "post", post, { name: "x" }),
		).toEqual({ ok: false, violations: [] });
	});
});

describe("manage minus a deny", () => {
	it("takes the field away from the action the deny names, and only there", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post"),
			deny("update", { post: ["authorId"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
		expect(fieldsOf(ability, "delete")).toEqual(only("id", "name", "authorId"));
		expect(rowsOf(ability, "update")).toEqual(EVERY_ROW);
	});

	it("takes the field away from every action when the deny is manage", () => {
		const ability = buildAbility(ac, [
			allow(["update", "delete"], "post"),
			deny("manage", { post: ["authorId"] }),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
		expect(fieldsOf(ability, "delete")).toEqual(only("id", "name"));
		expect(rowsOf(ability, "delete")).toEqual(EVERY_ROW);
	});

	it("loses an action to a deny that names no fields", () => {
		const ability = buildAbility(ac, [
			allow("manage", { post: ["name"] }),
			deny("delete", "post"),
		]);

		expect(fieldsOf(ability, "delete")).toEqual(only());
		expect(fieldsOf(ability, "update")).toEqual(only("name"));
	});

	it("takes it away wherever the deny is written", () => {
		const ability = buildAbility(ac, [
			deny("update", { post: ["authorId"] }),
			allow("manage", "post"),
		]);

		expect(fieldsOf(ability, "update")).toEqual(only("id", "name"));
	});
});

describe("manage", () => {
	it("gives its fields to every action the resource declares", () => {
		const ability = buildAbility(ac, [allow("manage", { post: ["name"] })]);

		expect(fieldsOf(ability, "read")).toEqual(only("name"));
		expect(fieldsOf(ability, "update")).toEqual(only("name"));
		expect(fieldsOf(ability, "delete")).toEqual(only("name"));
		expect(rowsOf(ability, "delete")).toEqual(EVERY_ROW);
	});

	it("stays on its own resource", () => {
		const ability = buildAbility(ac, [allow("manage", { post: ["id"] })]);

		expect(
			ability.permittedFields("delete", "comment", comment, ["id", "body"]),
		).toEqual([]);
	});

	it("gives the same fields inside a list", () => {
		const ability = buildAbility(ac, [
			allow(["read", "manage"], { post: ["name"] }),
		]);

		expect(fieldsOf(ability, "delete")).toEqual(only("name"));
	});

	it("writes nothing for a question about manage that gets past the types", () => {
		const ability = buildAbility(ac, [allow("manage", { post: ["name"] })]);

		expect(fieldsOf(ability, "manage")).toEqual(only());
	});

	it("still gives its fields to an action nobody declared", () => {
		const ability = buildAbility(ac, [allow("manage", { post: ["name"] })]);

		expect(fieldsOf(ability, "archive")).toEqual(only("name"));
	});
});

describe("a rule on the resource beside a rule on fields", () => {
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

	const answer = (ability: Ability, action: string) => ({
		...fieldsOf(ability, action),
		rows: rowsOf(ability, action),
		authorize: !refusesToAuthorize(ability, action),
		canMutate: ability.canMutate(action, "post"),
	});

	const granted = (...fields: Field[]) => ({
		...only(...fields),
		rows: EVERY_ROW,
		authorize: true,
		canMutate: true,
	});

	const refused = () => ({
		...only(),
		rows: NO_ROW,
		authorize: false,
		canMutate: false,
	});

	const ALL: Field[] = ["id", "name", "authorId"];

	const cases = [
		{
			name: "deny update post + allow update {name}",
			rules: [deny("update", "post"), allow("update", { post: ["name"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "deny manage post + allow update {name}",
			rules: [deny("manage", "post"), allow("update", { post: ["name"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "deny update post + allow manage {name}",
			rules: [deny("update", "post"), allow("manage", { post: ["name"] })],
			update: refused(),
			read: granted("name"),
		},
		{
			name: "deny manage post + allow manage {name}",
			rules: [deny("manage", "post"), allow("manage", { post: ["name"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "allow update post + allow update {name}",
			rules: [allow("update", "post"), allow("update", { post: ["name"] })],
			update: granted(...ALL),
			read: refused(),
		},
		{
			name: "allow manage post + allow update {name}",
			rules: [allow("manage", "post"), allow("update", { post: ["name"] })],
			update: granted(...ALL),
			read: granted(...ALL),
		},
		{
			name: "allow update post + allow manage {name}",
			rules: [allow("update", "post"), allow("manage", { post: ["name"] })],
			update: granted(...ALL),
			read: granted("name"),
		},
		{
			name: "allow manage post + allow manage {name}",
			rules: [allow("manage", "post"), allow("manage", { post: ["name"] })],
			update: granted(...ALL),
			read: granted(...ALL),
		},
		{
			name: "allow update post + deny update {authorId}",
			rules: [allow("update", "post"), deny("update", { post: ["authorId"] })],
			update: granted("id", "name"),
			read: refused(),
		},
		{
			name: "allow manage post + deny update {authorId}",
			rules: [allow("manage", "post"), deny("update", { post: ["authorId"] })],
			update: granted("id", "name"),
			read: granted(...ALL),
		},
		{
			name: "allow update post + deny manage {authorId}",
			rules: [allow("update", "post"), deny("manage", { post: ["authorId"] })],
			update: granted("id", "name"),
			read: refused(),
		},
		{
			name: "allow manage post + deny manage {authorId}",
			rules: [allow("manage", "post"), deny("manage", { post: ["authorId"] })],
			update: granted("id", "name"),
			read: granted("id", "name"),
		},
		{
			name: "deny update post + deny update {authorId}",
			rules: [deny("update", "post"), deny("update", { post: ["authorId"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "deny manage post + deny update {authorId}",
			rules: [deny("manage", "post"), deny("update", { post: ["authorId"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "deny update post + deny manage {authorId}",
			rules: [deny("update", "post"), deny("manage", { post: ["authorId"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "deny manage post + deny manage {authorId}",
			rules: [deny("manage", "post"), deny("manage", { post: ["authorId"] })],
			update: refused(),
			read: refused(),
		},
		{
			name: "allow manage post, then deny update post + deny update {authorId}",
			rules: [
				allow("manage", "post"),
				deny("update", "post"),
				deny("update", { post: ["authorId"] }),
			],
			update: refused(),
			read: granted(...ALL),
		},
		{
			name: "allow manage post, then deny manage post + deny update {authorId}",
			rules: [
				allow("manage", "post"),
				deny("manage", "post"),
				deny("update", { post: ["authorId"] }),
			],
			update: refused(),
			read: refused(),
		},
		{
			name: "allow manage post, then deny update post + deny manage {authorId}",
			rules: [
				allow("manage", "post"),
				deny("update", "post"),
				deny("manage", { post: ["authorId"] }),
			],
			update: refused(),
			read: granted("id", "name"),
		},
		{
			name: "allow manage post, then deny manage post + deny manage {authorId}",
			rules: [
				allow("manage", "post"),
				deny("manage", "post"),
				deny("manage", { post: ["authorId"] }),
			],
			update: refused(),
			read: refused(),
		},
	];

	for (const { name, rules, update, read } of cases) {
		it(`${name}: answers for update, for read and for nothing else, in either order`, () => {
			for (const policy of [rules, [...rules].reverse()]) {
				const ability = buildAbility(ac, policy);

				expect(answer(ability, "update")).toEqual(update);
				expect(answer(ability, "read")).toEqual(read);
				expect(ability.can("read", "comment", comment)).toBe(false);
				expect(
					ability.permittedFields("delete", "comment", comment, ["id", "body"]),
				).toEqual([]);
			}
		});
	}
});
