import { describe, expect, it } from "vitest";
import { permittedFields, validatePayload } from "../../src/api/mutation.js";
import { createSelect } from "../../src/compile/index.js";
import type {
	ConditionNode,
	FieldConditionNode,
	Row,
	Rule,
} from "../../src/model/index.js";

const MINE: ConditionNode<Row> = { field: "authorId", op: "eq", value: "u1" };
const BUSY: ConditionNode<Row> = { field: "views", op: "gt", value: 10 };
const DRAFT: FieldConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "draft",
};
const ARCHIVED: FieldConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "archived",
};

const mine = { id: "p1", authorId: "u1", status: "draft", views: 20 };
const theirs = { ...mine, authorId: "u2" };
const broken = { ...mine, views: "abc" };

const rule = (effect: string, extra: Partial<Rule> = {}): Rule =>
	({ effect, action: "update", resource: "post", ...extra }) as Rule;

const FIELDS = ["id", "authorId", "status", "title"];

const fieldsFor = (rules: Rule[], row: Row | undefined, fields = FIELDS) =>
	permittedFields(createSelect(rules)("update", "post"), row, fields);

const write = (rules: Rule[], row: Row | undefined, data: unknown) =>
	validatePayload(createSelect(rules)("update", "post"), row, data);

describe("the fields a form may offer", () => {
	it("are the fields the rules settle as writable", () => {
		expect(fieldsFor([rule("allow")], mine)).toEqual(FIELDS);
		expect(
			fieldsFor([rule("allow", { fields: ["status", "title"] })], mine),
		).toEqual(["status", "title"]);
		expect(
			fieldsFor([rule("allow"), rule("deny", { fields: ["authorId"] })], mine),
		).toEqual(["id", "status", "title"]);
		expect(fieldsFor([], mine)).toEqual([]);
		expect(fieldsFor([rule("allow"), rule("deny")], mine)).toEqual([]);
	});

	it("keep a field the rules cannot settle without a row, and drop it with one", () => {
		const rules = [rule("allow", { where: MINE, fields: ["title"] })];

		expect(fieldsFor(rules, undefined)).toEqual(["title"]);
		expect(fieldsFor(rules, mine)).toEqual(["title"]);
		expect(fieldsFor(rules, theirs)).toEqual([]);
		expect(fieldsFor([rule("allow", { where: BUSY })], broken)).toEqual([]);
	});

	it("keep a field a prohibition cannot settle without a row, and drop it with one", () => {
		const rules = [
			rule("allow"),
			rule("deny", { where: MINE, fields: ["authorId"] }),
		];

		expect(fieldsFor(rules, undefined)).toEqual(FIELDS);
		expect(fieldsFor(rules, mine)).toEqual(["id", "status", "title"]);
		expect(fieldsFor(rules, theirs)).toEqual(FIELDS);
	});

	it("are none for a row the check will not read, whatever it carries", () => {
		const entity = new (class Entity {
			id = "p1";
			authorId = "u1";
		})();

		for (const row of [entity, [mine], new Date()]) {
			expect(
				fieldsFor([rule("allow", { where: MINE })], row as unknown as Row),
			).toEqual([]);
		}
	});

	it("never include a name every object inherits", () => {
		expect(
			fieldsFor([rule("allow")], mine, [
				"__proto__",
				"constructor",
				"prototype",
				"id",
			]),
		).toEqual(["id"]);
		expect(
			fieldsFor(
				[rule("allow", { fields: ["constructor", "prototype"] as never })],
				undefined,
				["constructor", "prototype"],
			),
		).toEqual([]);
	});

	it("come back in the order they were asked, as a new list", () => {
		const asked = ["title", "id"];
		const offered = fieldsFor([rule("allow")], mine, asked);

		expect(offered).toEqual(["title", "id"]);
		expect(offered).not.toBe(asked);
	});
});

describe("a write refused as a whole", () => {
	it.each([
		["data that is null", [rule("allow")], mine, null],
		["data that is an array", [rule("allow")], mine, ["x"]],
		["data that is a string", [rule("allow")], mine, "x"],
		[
			"data that is a class instance",
			[rule("allow")],
			mine,
			new (class Data {
				id = "x";
			})(),
		],
		["no permission", [], mine, { id: "x" }],
		["a blanket prohibition", [rule("allow"), rule("deny")], mine, { id: "x" }],
		[
			"a row the permission does not hold for",
			[rule("allow", { where: MINE })],
			theirs,
			{ id: "x" },
		],
		[
			"no row for a permission that needs one",
			[rule("allow", { where: MINE })],
			undefined,
			{ id: "x" },
		],
		[
			"no row for a prohibition that needs one",
			[rule("allow"), rule("deny", { where: MINE })],
			undefined,
			{ id: "x" },
		],
		[
			"a row the permission cannot read",
			[rule("allow", { where: BUSY })],
			broken,
			{ id: "x" },
		],
		["an empty write under no permission", [], mine, {}],
	] as [
		string,
		Rule[],
		Row | undefined,
		unknown,
	][])("for %s names no field", (_name, rules, row, data) => {
		expect(write(rules, row, data)).toEqual({ ok: false, violations: [] });
	});
});

describe("a write refused field by field", () => {
	it("names every field the rules do not permit", () => {
		expect(
			write([rule("allow", { fields: ["title"] })], mine, {
				title: "t",
				id: "x",
				authorId: "u2",
			}),
		).toEqual({
			ok: false,
			violations: [
				{ field: "id", reason: "field not permitted" },
				{ field: "authorId", reason: "field not permitted" },
			],
		});
	});

	it("names a field a prohibition takes away", () => {
		expect(
			write([rule("allow"), rule("deny", { fields: ["authorId"] })], mine, {
				authorId: "u2",
			}),
		).toEqual({
			ok: false,
			violations: [{ field: "authorId", reason: "field not permitted" }],
		});
	});

	it("names a field whose prohibition cannot read the row", () => {
		expect(
			write(
				[rule("allow"), rule("deny", { where: BUSY, fields: ["title"] })],
				broken,
				{ title: "t", id: "x" },
			),
		).toEqual({
			ok: false,
			violations: [{ field: "title", reason: "field not permitted" }],
		});
	});

	it("names a value no permission allows", () => {
		expect(
			write([rule("allow", { values: DRAFT })], mine, {
				status: "archived",
				id: "x",
			}),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});
	});

	it("names a value no permission can compare", () => {
		expect(
			write([rule("allow", { values: DRAFT })], mine, { status: ["draft"] }),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});
	});

	it("names a value a prohibition takes away", () => {
		expect(
			write([rule("allow"), rule("deny", { values: ARCHIVED })], mine, {
				status: "archived",
			}),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value denied" }],
		});
	});

	it("names a value a prohibition cannot settle without a row as denied", () => {
		expect(
			write(
				[rule("allow"), rule("deny", { where: MINE, values: ARCHIVED })],
				undefined,
				{ status: "archived" },
			),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value denied" }],
		});
	});

	it("names the permission's refusal over a prohibition it could not settle", () => {
		expect(
			write(
				[
					rule("allow", { values: DRAFT }),
					rule("deny", { where: MINE, values: ARCHIVED }),
				],
				undefined,
				{ status: "archived" },
			),
		).toEqual({
			ok: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		});
	});

	it("refuses a name every object inherits, whatever the rules say", () => {
		const data = JSON.parse(
			'{"__proto__": 1, "constructor": 2, "prototype": 3}',
		);

		expect(
			write(
				[rule("allow", { fields: ["constructor", "prototype"] as never })],
				mine,
				data,
			),
		).toEqual({
			ok: false,
			violations: [
				{ field: "__proto__", reason: "field not permitted" },
				{ field: "constructor", reason: "field not permitted" },
				{ field: "prototype", reason: "field not permitted" },
			],
		});
	});
});

describe("a write that passes", () => {
	it("hands back a copy of exactly the keys that were sent", () => {
		const data = { status: "draft", title: "t" };
		const result = write([rule("allow", { values: DRAFT })], mine, data);

		expect(result).toEqual({ ok: true, data });
		expect(result.ok && result.data).not.toBe(data);
	});

	it("passes an empty write the row gate lets through", () => {
		expect(write([rule("allow")], undefined, {})).toEqual({
			ok: true,
			data: {},
		});
	});

	it("reads the data's own keys, not what it inherits", () => {
		const data = Object.assign(Object.create({ authorId: "u2" }), {
			title: "t",
		});

		expect(write([rule("allow", { fields: ["title"] })], mine, data)).toEqual({
			ok: true,
			data: { title: "t" },
		});
	});
});
