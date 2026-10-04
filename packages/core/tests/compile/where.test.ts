import { describe, expect, it } from "vitest";
import { createSelect, whereOf } from "../../src/compile/index.js";
import type { ConditionNode, Row, Rule } from "../../src/model/index.js";

const MINE: ConditionNode<Row> = { field: "authorId", op: "eq", value: "u1" };
const PUBLISHED: ConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "published",
};
const ARCHIVED: ConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "archived",
};
const BANNED: ConditionNode<Row> = {
	field: "authorId",
	op: "eq",
	value: "banned",
};

const allow = (where?: ConditionNode<Row>, extra?: Partial<Rule>): Rule =>
	({
		effect: "allow",
		action: "read",
		resource: "post",
		...(where === undefined ? {} : { where }),
		...extra,
	}) as Rule;

const deny = (where?: ConditionNode<Row>, extra?: Partial<Rule>): Rule => ({
	...allow(where, extra),
	effect: "deny",
});

const whereFor = (rules: Rule[], action = "read") =>
	whereOf(createSelect(rules)(action, "post"));

describe("the condition a database is handed", () => {
	it("selects nothing when no allow applies", () => {
		expect(whereFor([])).toEqual({ or: [] });
		expect(whereFor([deny()])).toEqual({ or: [] });
		expect(whereFor([deny(ARCHIVED)])).toEqual({ or: [] });
		expect(whereFor([allow(MINE)], "update")).toEqual({ or: [] });
	});

	it("selects everything for an allow with no condition", () => {
		expect(whereFor([allow()])).toEqual({ and: [] });
		expect(whereFor([allow(MINE), allow()])).toEqual({ and: [] });
		expect(whereFor([allow(), allow(MINE)])).toEqual({ and: [] });
	});

	it("hands over the single condition of one conditional allow", () => {
		expect(whereFor([allow(MINE)])).toEqual(MINE);
	});

	it("ors the conditions of several allows", () => {
		expect(whereFor([allow(MINE), allow(PUBLISHED)])).toEqual({
			or: [MINE, PUBLISHED],
		});
	});

	it("selects nothing under a deny with no condition, wherever it is written", () => {
		expect(whereFor([allow(), deny()])).toEqual({ or: [] });
		expect(whereFor([deny(), allow(MINE)])).toEqual({ or: [] });
		expect(whereFor([allow(MINE), deny(ARCHIVED), deny()])).toEqual({
			or: [],
		});
	});

	it("reduces an allow with no condition and a conditional deny to not deny", () => {
		expect(whereFor([allow(), deny(ARCHIVED)])).toEqual({ not: ARCHIVED });
	});

	it("ands a conditional allow with not deny", () => {
		expect(whereFor([allow(MINE), deny(ARCHIVED)])).toEqual({
			and: [MINE, { not: ARCHIVED }],
		});
	});

	it("groups several conditional denies under one not or", () => {
		expect(whereFor([allow(), deny(ARCHIVED), deny(BANNED)])).toEqual({
			not: { or: [ARCHIVED, BANNED] },
		});
	});

	it("intersects several allows with several denies", () => {
		expect(
			whereFor([allow(MINE), allow(PUBLISHED), deny(ARCHIVED), deny(BANNED)]),
		).toEqual({
			and: [{ or: [MINE, PUBLISHED] }, { not: { or: [ARCHIVED, BANNED] } }],
		});
	});

	it("leaves out a deny that speaks about fields or values", () => {
		const aboutFields = deny(undefined, { fields: ["status"] });
		const aboutValues = deny(undefined, { values: ARCHIVED as never });
		const onRowsAboutFields = deny(ARCHIVED, { fields: ["status"] });

		expect(whereFor([allow(), aboutFields, aboutValues])).toEqual({
			and: [],
		});
		expect(whereFor([allow(MINE), onRowsAboutFields])).toEqual(MINE);
		expect(whereFor([allow(), onRowsAboutFields, deny(BANNED)])).toEqual({
			not: BANNED,
		});
	});

	it("keeps an allow that speaks about fields or values, by its rows", () => {
		expect(whereFor([allow(undefined, { fields: ["status"] })])).toEqual({
			and: [],
		});
		expect(whereFor([allow(MINE, { values: ARCHIVED as never })])).toEqual(
			MINE,
		);
	});
});
