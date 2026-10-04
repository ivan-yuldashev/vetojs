import { describe, expect, it } from "vitest";
import type { WhenNode } from "../../src/model/index.js";
import { ABSENT, OPERATOR_SUITES } from "../operator-cases.js";
import { whenAnswerOf } from "../verdict-of.js";

for (const { title, condition, field, cases } of OPERATOR_SUITES) {
	describe(`${title} in when`, () => {
		for (const [name, value, answer] of cases) {
			const isLacking = value === ABSENT || value === undefined;
			const expected = isLacking ? "unknown" : answer;

			it(`${name}: answers ${expected}`, () => {
				const env = value === ABSENT ? {} : { [field]: value };

				expect(whenAnswerOf(condition as WhenNode, env)).toBe(expected);
			});
		}
	});
}
