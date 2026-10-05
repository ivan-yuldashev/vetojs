import { describe, expect, it } from "vitest";
import { checkField, checkRow, wheresOf } from "../../src/check/index.js";
import { createSelect } from "../../src/compile/index.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import type {
	ConditionNode,
	FieldConditionNode,
	Row,
	Rule,
} from "../../src/model/index.js";
import { markLoaded } from "../../src/row/index.js";

const MINE: ConditionNode<Row> = { field: "authorId", op: "eq", value: "u1" };
const LOCKED: ConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "locked",
};
const BUSY: ConditionNode<Row> = { field: "views", op: "gt", value: 10 };
const BY_ADMIN: ConditionNode<Row> = {
	relation: "author",
	type: "one",
	where: { field: "role", op: "eq", value: "admin" },
};

const mine = { id: "p1", authorId: "u1", status: "draft", views: 20 };
const theirs = { ...mine, authorId: "u2" };
const locked = { ...mine, status: "locked" };
const broken = { ...mine, views: "abc" };

const rule = (effect: string, extra: Partial<Rule> = {}): Rule =>
	({ effect, action: "update", resource: "post", ...extra }) as Rule;

const grant = rule("allow");
const blanket = rule("deny");
const mineOnly = rule("allow", { where: MINE });
const busyOnly = rule("allow", { where: BUSY });
const lockedOut = rule("deny", { where: LOCKED });
const busyOut = rule("deny", { where: BUSY });
const titleOnly = rule("allow", { fields: ["title"] });
const noTitle = rule("deny", { fields: ["title"] });

type Input = { row?: Row | undefined; field?: string; payload?: Row };

const checkOf = (rules: Rule[]) => {
	const select = createSelect(rules);

	return (action: string, resource: string, input: Input = {}) => {
		const selected = select(action, resource);
		const rowResult = checkRow(selected, input.row, true);

		if (input.field === undefined || rowResult.reason !== undefined) {
			return rowResult;
		}

		return checkField(
			selected,
			wheresOf(selected, input.row),
			input.field,
			input.payload,
			true,
		);
	};
};

const result = (
	verdict: boolean | undefined,
	allowRule?: Rule,
	denyRule?: Rule,
) => ({ verdict, allowRule, denyRule });

describe("a check on a row", () => {
	it.each([
		["nothing names the pair", [], mine, result(false)],
		["an allow grants", [grant], mine, result(true, grant)],
		[
			"a deny overrides it",
			[grant, blanket],
			mine,
			result(false, undefined, blanket),
		],
		[
			"a deny written first overrides it",
			[blanket, grant],
			mine,
			result(false, undefined, blanket),
		],
		["a deny alone fires", [blanket], mine, result(false, undefined, blanket)],
		[
			"an allow whose condition holds",
			[mineOnly],
			mine,
			result(true, mineOnly),
		],
		["an allow whose condition fails", [mineOnly], theirs, result(false)],
		[
			"a deny whose condition holds",
			[grant, lockedOut],
			locked,
			result(false, undefined, lockedOut),
		],
		[
			"a deny whose condition fails",
			[grant, lockedOut],
			mine,
			result(true, grant),
		],
		[
			"the first allow that holds is named",
			[mineOnly, grant],
			mine,
			result(true, mineOnly),
		],
		[
			"an allow that fails steps aside for one that holds",
			[mineOnly, grant],
			theirs,
			result(true, grant),
		],
		[
			"the first deny that fires is named",
			[grant, lockedOut, blanket],
			locked,
			result(false, undefined, lockedOut),
		],
		[
			"an allow on broken data leaves the answer open",
			[busyOnly],
			broken,
			result(undefined, busyOnly),
		],
		[
			"a deny on broken data leaves the answer open",
			[grant, busyOut],
			broken,
			result(undefined, grant, busyOut),
		],
		[
			"a broken allow gives way to one that holds",
			[busyOnly, grant],
			broken,
			result(true, grant),
		],
		[
			"a broken deny gives way to one that fires",
			[grant, busyOut, lockedOut],
			{ ...locked, views: "abc" },
			result(false, undefined, lockedOut),
		],
		[
			"the first broken deny is named",
			[
				grant,
				busyOut,
				rule("deny", { where: { field: "views", op: "lt", value: 99 } }),
			],
			broken,
			result(undefined, grant, busyOut),
		],
		[
			"a broken deny beside an allow that fails",
			[mineOnly, busyOut],
			{ ...broken, authorId: "u2" },
			result(false),
		],
		[
			"a field allow grants the row",
			[titleOnly],
			mine,
			result(true, titleOnly),
		],
		[
			"a field deny leaves the row to the allow",
			[grant, noTitle],
			mine,
			result(true, grant),
		],
		["a field deny alone grants nothing", [noTitle], mine, result(false)],
	] as [
		string,
		Rule[],
		Row,
		ReturnType<typeof result>,
	][])("%s", (_name, rules, row, expected) => {
		expect(checkOf(rules)("update", "post", { row })).toEqual(expected);
	});
});

describe("a check without a row", () => {
	it.each([
		["nothing names the pair", [], result(false)],
		["an allow grants", [grant], result(true, grant)],
		[
			"a deny overrides it",
			[grant, blanket],
			result(false, undefined, blanket),
		],
		["an allow that needs the row", [mineOnly], result(undefined, mineOnly)],
		[
			"the first allow that needs the row is named",
			[mineOnly, busyOnly],
			result(undefined, mineOnly),
		],
		[
			"a deny that needs the row",
			[grant, lockedOut],
			result(undefined, grant, lockedOut),
		],
		[
			"a blanket deny beside an allow that needs the row",
			[mineOnly, blanket],
			result(false, undefined, blanket),
		],
		["a field allow", [titleOnly], result(true, titleOnly)],
		["a field deny beside an allow", [grant, noTitle], result(true, grant)],
	] as [
		string,
		Rule[],
		ReturnType<typeof result>,
	][])("%s", (_name, rules, expected) => {
		const check = checkOf(rules);

		expect(check("update", "post")).toEqual(expected);
		expect(check("update", "post", {})).toEqual(expected);
		expect(check("update", "post", { row: undefined })).toEqual(expected);
	});

	it("hands back the same answer for a pair asked twice", () => {
		const check = checkOf([grant, rule("allow", { action: "read" })]);
		const first = check("update", "post");

		expect(check("read", "post")).toEqual(
			result(true, rule("allow", { action: "read" })),
		);
		expect(check("update", "post")).toEqual(first);
	});
});

describe("a check on a field", () => {
	it("answers by the fields the rules name", () => {
		const check = checkOf([titleOnly]);

		expect(check("update", "post", { row: mine, field: "title" }).verdict).toBe(
			true,
		);
		expect(check("update", "post", { row: mine, field: "id" }).verdict).toBe(
			false,
		);
		expect(check("update", "post", { field: "id" }).verdict).toBe(false);
	});

	it("takes a field away with a deny that names it", () => {
		const check = checkOf([grant, noTitle]);

		expect(check("update", "post", { field: "title" })).toEqual(
			result(false, undefined, noTitle),
		);
		expect(check("update", "post", { field: "id" })).toEqual(
			result(true, grant),
		);
	});

	it("judges a value by the payload it is handed", () => {
		const check = checkOf([
			rule("allow", { values: { field: "status", op: "eq", value: "draft" } }),
		]);

		expect(
			check("update", "post", { field: "status", payload: { status: "draft" } })
				.verdict,
		).toBe(true);
		expect(
			check("update", "post", {
				field: "status",
				payload: { status: "archived" },
			}).verdict,
		).toBe(false);
	});
});

describe("a row the check will not read", () => {
	it.each([
		["an array", []],
		["a date", new Date()],
		[
			"a class instance",
			new (class Entity {
				id = "p1";
			})(),
		],
		["null", null],
		["a number", 7],
		["a string", "row"],
	])("refuses %s without reading a rule", (_name, row) => {
		const refused = {
			verdict: false,
			allowRule: undefined,
			denyRule: undefined,
			reason: "not a plain row",
		};
		const check = checkOf([grant]);

		expect(check("update", "post", { row: row as unknown as Row })).toEqual(
			refused,
		);
		expect(
			check("update", "post", { row: row as unknown as Row, field: "title" }),
		).toEqual(refused);
	});

	it("reads a row built without a prototype", () => {
		const bare = Object.assign(Object.create(null), mine) as Row;

		expect(checkOf([mineOnly])("update", "post", { row: bare }).verdict).toBe(
			true,
		);
	});
});

describe("a relation the rules of the pair reach", () => {
	const reaching = [grant, rule("allow", { where: BY_ADMIN })];

	it("must be loaded, even when an earlier rule already answered", () => {
		expect(() => checkOf(reaching)("update", "post", { row: mine })).toThrow(
			RelationNotLoadedError,
		);
	});

	it("must be loaded under a deny that an earlier deny already settled", () => {
		const check = checkOf([grant, blanket, rule("deny", { where: BY_ADMIN })]);

		expect(() => check("update", "post", { row: mine })).toThrow(
			RelationNotLoadedError,
		);
	});

	it("is not asked for without a row", () => {
		expect(checkOf(reaching)("update", "post")).toEqual(result(true, grant));
		expect(checkOf(reaching)("update", "post", { field: "title" })).toEqual(
			result(true, grant),
		);
	});

	it("answers once it is loaded, or marked loaded and empty", () => {
		const check = checkOf(reaching);

		expect(
			check("update", "post", { row: { ...mine, author: null } }).verdict,
		).toBe(true);
		expect(
			check("update", "post", { row: markLoaded(mine, "author", null) })
				.verdict,
		).toBe(true);
	});

	it("is not asked for by a pair that does not reach it", () => {
		expect(checkOf(reaching)("read", "post", { row: mine })).toEqual(
			result(false),
		);
	});
});

describe("one rule, judged alone", () => {
	const DRAFT: FieldConditionNode<Row> = {
		field: "status",
		op: "eq",
		value: "draft",
	};
	const garbled = { ...mine, authorId: ["u1"] };

	const permits = (shape: Partial<Rule>, input: Input = {}) =>
		checkOf([rule("allow", shape)])("update", "post", input).verdict;

	const fires = (shape: Partial<Rule>, input: Input = {}) => {
		const { verdict } = checkOf([grant, rule("deny", shape)])(
			"update",
			"post",
			input,
		);

		return verdict === undefined ? undefined : !verdict;
	};

	it("holds for every question when it names nothing but a target", () => {
		for (const input of [
			{},
			{ row: mine },
			{ row: theirs, field: "status" },
			{ field: "status", payload: { status: "archived" } },
		]) {
			expect(permits({}, input)).toBe(true);
			expect(fires({}, input)).toBe(true);
		}
	});

	describe("a condition", () => {
		it("answers for the row it is shown", () => {
			expect(permits({ where: MINE }, { row: mine })).toBe(true);
			expect(permits({ where: MINE }, { row: theirs })).toBe(false);
			expect(permits({ where: MINE }, { row: garbled })).toBeUndefined();
		});

		it("cannot answer without a row", () => {
			expect(permits({ where: MINE })).toBeUndefined();
			expect(permits({ where: MINE }, { field: "status" })).toBeUndefined();
		});

		it("reads the row, not the field or the payload", () => {
			expect(
				permits(
					{ where: MINE },
					{ row: mine, field: "id", payload: { id: "x" } },
				),
			).toBe(true);
			expect(
				permits(
					{ where: MINE },
					{ row: theirs, field: "authorId", payload: mine },
				),
			).toBe(false);
		});
	});

	describe("a list of fields", () => {
		const fields: Rule["fields"] = ["status", "title"];

		it("says whether it names the field asked about", () => {
			expect(permits({ fields }, { field: "status" })).toBe(true);
			expect(permits({ fields }, { field: "title", row: theirs })).toBe(true);
			expect(permits({ fields }, { field: "id" })).toBe(false);
			expect(permits({ fields }, { field: "" })).toBe(false);
		});

		it("grants the row when no field is asked about", () => {
			expect(permits({ fields })).toBe(true);
			expect(permits({ fields }, { row: mine })).toBe(true);
		});
	});

	describe("a value constraint", () => {
		it("judges the value the payload carries for its field", () => {
			const at = (status: unknown) =>
				permits({ values: DRAFT }, { field: "status", payload: { status } });

			expect(at("draft")).toBe(true);
			expect(at("archived")).toBe(false);
			expect(at(["draft"])).toBeUndefined();
		});

		it("answers unknown for a value written as undefined, which is not a missing key", () => {
			expect(
				permits(
					{ values: DRAFT },
					{ field: "status", payload: { status: undefined } },
				),
			).toBeUndefined();
		});

		it("lets through a field it does not constrain, and a field asked without a payload", () => {
			expect(
				permits({ values: DRAFT }, { field: "title", payload: { title: "t" } }),
			).toBe(true);
			expect(permits({ values: DRAFT }, { field: "status" })).toBe(true);
			expect(permits({ values: DRAFT })).toBe(true);
			expect(
				permits({ values: DRAFT }, { row: mine, payload: { status: "x" } }),
			).toBe(true);
		});

		it("requires every constraint an and puts on one field", () => {
			const values: FieldConditionNode<Row> = {
				and: [
					{ field: "title", op: "contains", value: "a" },
					{ and: [{ field: "title", op: "contains", value: "b" }] },
				],
			};
			const at = (title: string) =>
				permits({ values }, { field: "title", payload: { title } });

			expect(at("ab")).toBe(true);
			expect(at("a")).toBe(false);
			expect(at("b")).toBe(false);
		});

		it("judges each field by its own constraints", () => {
			const values: FieldConditionNode<Row> = {
				and: [DRAFT, { field: "title", op: "eq", value: "t" }],
			};
			const payload = { status: "draft", title: "other" };

			expect(permits({ values }, { field: "status", payload })).toBe(true);
			expect(permits({ values }, { field: "title", payload })).toBe(false);
		});
	});

	describe("a permission with several parts", () => {
		it("needs every part that speaks, and lets a silent part agree", () => {
			const shape: Partial<Rule> = {
				where: MINE,
				fields: ["status", "title"],
				values: DRAFT,
			};
			const draft = { status: "draft" };
			const archived = { status: "archived" };

			expect(permits(shape, { row: mine })).toBe(true);
			expect(permits(shape, { row: theirs })).toBe(false);
			expect(permits(shape)).toBeUndefined();
			expect(permits(shape, { row: mine, field: "title" })).toBe(true);
			expect(permits(shape, { row: mine, field: "id" })).toBe(false);
			expect(permits(shape, { row: theirs, field: "title" })).toBe(false);
			expect(permits(shape, { field: "title" })).toBeUndefined();
			expect(
				permits(shape, { row: mine, field: "status", payload: draft }),
			).toBe(true);
			expect(
				permits(shape, { row: mine, field: "status", payload: archived }),
			).toBe(false);
			expect(permits(shape, { field: "status", payload: archived })).toBe(
				false,
			);
		});

		it("lets fields and values each narrow a write", () => {
			const shape: Partial<Rule> = { fields: ["status"], values: DRAFT };

			expect(permits(shape)).toBe(true);
			expect(permits(shape, { field: "status" })).toBe(true);
			expect(permits(shape, { field: "title" })).toBe(false);
			expect(
				permits(shape, { field: "status", payload: { status: "draft" } }),
			).toBe(true);
			expect(
				permits(shape, { field: "status", payload: { status: "archived" } }),
			).toBe(false);
		});
	});

	describe("a prohibition with several parts", () => {
		it("fires on its rows only for what its payload part names", () => {
			const shape: Partial<Rule> = { where: MINE, fields: ["status"] };

			expect(fires(shape, { row: mine })).toBe(false);
			expect(fires(shape)).toBe(false);
			expect(fires(shape, { row: mine, field: "status" })).toBe(true);
			expect(fires(shape, { row: mine, field: "title" })).toBe(false);
			expect(fires(shape, { row: theirs, field: "status" })).toBe(false);
			expect(fires(shape, { field: "status" })).toBeUndefined();
			expect(fires(shape, { row: garbled, field: "status" })).toBeUndefined();
		});

		it("fires for a field it names or a value it constrains, either one", () => {
			const shape: Partial<Rule> = { fields: ["title"], values: DRAFT };
			const at = (status: unknown) =>
				fires(shape, { field: "status", payload: { status } });

			expect(fires(shape)).toBe(false);
			expect(fires(shape, { field: "title" })).toBe(true);
			expect(fires(shape, { field: "title", payload: { title: "t" } })).toBe(
				true,
			);
			expect(fires(shape, { field: "id" })).toBe(false);
			expect(at("draft")).toBe(true);
			expect(at("archived")).toBe(false);
			expect(at(["draft"])).toBeUndefined();
		});

		it("fires for a field it both names and constrains, whatever the value", () => {
			const shape: Partial<Rule> = { fields: ["status"], values: DRAFT };
			const at = (status: unknown) =>
				fires(shape, { field: "status", payload: { status } });

			expect(at("draft")).toBe(true);
			expect(at("archived")).toBe(true);
			expect(fires(shape, { field: "title", payload: { title: "t" } })).toBe(
				false,
			);
		});

		it("fires on its rows for a value it constrains", () => {
			const shape: Partial<Rule> = { where: MINE, values: DRAFT };
			const draft = { field: "status", payload: { status: "draft" } };

			expect(fires(shape, { row: mine, ...draft })).toBe(true);
			expect(fires(shape, { row: theirs, ...draft })).toBe(false);
			expect(fires(shape, draft)).toBeUndefined();
			expect(fires(shape, { row: mine })).toBe(false);
			expect(
				fires(shape, { row: mine, field: "status", payload: { status: "x" } }),
			).toBe(false);
		});
	});
});
