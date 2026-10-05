import { describe, expect, it } from "vitest";
import type { ConditionNode, Row } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";
import {
	ABSENT,
	OPERATOR_SUITES,
	type OperatorCase,
} from "../operator-cases.js";
import { answerOf, FAILS, HOLDS, node } from "../verdict-of.js";

const rowWith = (field: string, value: unknown): Row =>
	value === ABSENT ? { id: "p1" } : { id: "p1", [field]: value };

const operator = (
	title: string,
	condition: ConditionNode<Row>,
	field: string,
	cases: OperatorCase[],
) => {
	describe(title, () => {
		for (const [name, value, answer] of cases) {
			it(`${name}: answers ${answer}, alone and beside another condition`, () => {
				const row = rowWith(field, value);

				expect(answerOf(condition, row)).toBe(answer);
				expect(answerOf({ and: [HOLDS, condition] }, row)).toBe(answer);
				expect(answerOf({ or: [FAILS, condition] }, row)).toBe(answer);
				expect(answerOf({ and: [FAILS, condition] }, row)).toBe("no");
				expect(answerOf({ or: [HOLDS, condition] }, row)).toBe("yes");
			});
		}
	});
};

for (const { title, condition, field, cases } of OPERATOR_SUITES) {
	operator(title, condition, field, cases);
}

describe("a value the rule itself gets wrong", () => {
	const refusal = (op: string, value: unknown) =>
		parseRules([
			{
				effect: "deny",
				action: "update",
				resource: "post",
				where: { field: "views", op, value },
			},
		]);

	it("is refused when it arrives from outside", () => {
		const refused: [op: string, value: unknown, message: string][] = [
			["in", "draft", 'expected an array for "in"'],
			["nin", "draft", 'expected an array for "nin"'],
			["hasAny", "x", 'expected an array for "hasAny"'],
			["hasAll", "x", 'expected an array for "hasAll"'],
			["exists", "yes", 'expected a boolean for "exists"'],
			["contains", 5, 'expected a string for "contains"'],
			["contains", null, 'expected a string for "contains"'],
			["gt", null, 'expected a number for "gt"'],
			["gte", {}, 'expected a number for "gte"'],
			["lt", true, 'expected a number for "lt"'],
			["lte", [10], 'expected a number for "lte"'],
			["gt", "b", 'expected a number for "gt"'],
			["like", "x", 'unknown operator "like"'],
		];

		for (const [op, value, message] of refused) {
			expect(refusal(op, value)).toEqual({
				ok: false,
				errors: [expect.stringContaining(message)],
			});
		}
	});

	it("answers unknown if one gets past the checks", () => {
		const row = { id: "p1", status: "draft", views: 10, tags: ["x"] };
		const broken: ConditionNode<Row>[] = [
			node("status", "in", "draft"),
			node("status", "nin", "draft"),
			node("tags", "hasAny", "x"),
			node("tags", "hasAll", "x"),
			node("status", "exists", "yes"),
			node("views", "gte", {}),
			node("status", "eq", {}),
			node("status", "like", "draft"),
		];

		for (const condition of broken) {
			expect(answerOf(condition, row)).toBe("unknown");
			expect(answerOf({ not: condition }, row)).toBe("unknown");
		}
	});
});
