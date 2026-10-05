import { describe, expect, it } from "vitest";
import { compileRule } from "../../src/compile/rule.js";
import type {
	ConditionNode,
	FieldConditionNode,
	Row,
	Rule,
} from "../../src/model/index.js";

const MINE: ConditionNode<Row> = { field: "authorId", op: "eq", value: "u1" };
const DRAFT: FieldConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "draft",
};

type Shape = Pick<Rule, "where" | "fields" | "values">;

const compiledOf = (effect: "allow" | "deny", shape: Shape) => {
	const rule = { effect, action: "update", resource: "post", ...shape } as Rule;

	return { rule, compiled: compileRule(rule) };
};

describe("what a compiled rule remembers about itself", () => {
	it.each([
		["allow", {}, false],
		["deny", {}, false],
		["allow", { where: MINE }, false],
		["deny", { where: MINE }, false],
		["allow", { fields: ["status"] }, true],
		["deny", { fields: ["status"] }, true],
		["allow", { values: DRAFT }, true],
		["deny", { values: DRAFT }, true],
		["deny", { where: MINE, fields: ["status"] }, true],
		["deny", { where: MINE, values: DRAFT }, true],
	] as [
		"allow" | "deny",
		Shape,
		boolean,
	][])("%s %j: field level %s", (effect, shape, isFieldLevel) => {
		const { rule, compiled } = compiledOf(effect, shape);

		expect(compiled.rule).toBe(rule);
		expect(compiled.isFieldLevel).toBe(isFieldLevel);
		expect(compiled.where).toBe(shape.where);
		expect(compiled.match === undefined).toBe(shape.where === undefined);
		expect(compiled.fields).toBe(shape.fields);
	});

	it("files value constraints under the field they constrain, every and flattened", () => {
		const { compiled } = compiledOf("allow", {
			values: {
				and: [
					{ field: "title", op: "contains", value: "a" },
					{ and: [DRAFT, { field: "title", op: "contains", value: "b" }] },
				],
			},
		});

		expect(compiled.values).toEqual(
			new Map([
				[
					"title",
					[
						{ field: "title", op: "contains", value: "a" },
						{ field: "title", op: "contains", value: "b" },
					],
				],
				["status", [DRAFT]],
			]),
		);
	});
});
