import { describe, expect, it } from "vitest";
import {
	CONDITION_OPERATORS,
	type FieldConditionNode,
	type Row,
} from "../../src/model/index.js";
import { ABSENT, OPERATOR_SUITES } from "../operator-cases.js";
import { valuesAnswerOf } from "../verdict-of.js";

const ROW = { id: "p1" };

describe("the operator suites", () => {
	it("cover every operator the engine knows", () => {
		const covered = new Set(
			OPERATOR_SUITES.map(({ condition }) =>
				"op" in condition ? condition.op : undefined,
			),
		);

		expect([...covered].sort()).toEqual([...CONDITION_OPERATORS].sort());
	});
});

for (const { title, condition, field, cases } of OPERATOR_SUITES) {
	const values = condition as FieldConditionNode<Row>;
	const beside = field === "note" ? "memo" : "note";

	describe(`${title} in values`, () => {
		it("leaves a write without the field unasked", () => {
			expect(valuesAnswerOf(values, { [beside]: "x" }, ROW)).toEqual({
				[beside]: "free",
			});
		});

		for (const [name, value, answer] of cases) {
			if (value === ABSENT) {
				continue;
			}

			it(`${name}: answers ${answer} with a row and without one, and leaves the other field free`, () => {
				const data = { [field]: value, [beside]: "x" };
				const expected = { [field]: answer, [beside]: "free" };

				expect(valuesAnswerOf(values, data, ROW)).toEqual(expected);
				expect(valuesAnswerOf(values, data, undefined)).toEqual(expected);
			});
		}
	});
}
