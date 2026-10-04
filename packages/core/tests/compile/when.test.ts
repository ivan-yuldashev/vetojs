import { afterEach, describe, expect, it } from "vitest";
import type { RulesByEffect } from "../../src/compile/index.js";
import { createSelect, resolveWhen } from "../../src/compile/index.js";
import type {
	ConditionNode,
	Row,
	Rule,
	WhenNode,
} from "../../src/model/index.js";

const IN_EU: WhenNode = { field: "region", op: "eq", value: "eu" };
const WITH_MFA: WhenNode = { field: "mfa", op: "eq", value: true };

const rule = (effect: string, extra: Partial<Rule> = {}): Rule =>
	({ effect, action: "read", resource: "post", ...extra }) as Rule;

const selectionOf = (rules: Rule[]) =>
	createSelect(rules, true)("read", "post");

const taking = (rules: Rule[], selected: RulesByEffect) => ({
	allow: selected.allow.map((compiled) => rules.indexOf(compiled.rule)),
	deny: selected.deny.map((compiled) => rules.indexOf(compiled.rule)),
});

afterEach(() => {
	delete (Object.prototype as Record<string, unknown>).when;
});

describe("the rules an environment lets take part", () => {
	const rules = [rule("allow", { when: IN_EU }), rule("deny", { when: IN_EU })];

	it.each([
		["meets when", { region: "eu" }, { allow: [0], deny: [1] }],
		["fails it", { region: "us" }, { allow: [], deny: [] }],
		["lacks the key", {}, { allow: [], deny: [1] }],
		[
			"holds the key as undefined",
			{ region: undefined },
			{ allow: [], deny: [1] },
		],
		[
			"only inherits the key",
			Object.create({ region: "eu" }),
			{ allow: [], deny: [1] },
		],
	])("in an environment that %s", (_, env, expected) => {
		expect(taking(rules, resolveWhen(selectionOf(rules), env as Row))).toEqual(
			expected,
		);
	});

	it("hands back a selection without when as it is", () => {
		const selected = selectionOf([rule("allow"), rule("deny")]);

		expect(resolveWhen(selected, { region: "eu" })).toBe(selected);
	});

	it("reads when and its own state only from the objects themselves", () => {
		(Object.prototype as Record<string, unknown>).when = {
			field: "region",
			op: "eq",
			value: "nowhere",
		};

		const plain = [rule("allow"), rule("deny")];
		const selected = selectionOf(plain);

		expect(taking(plain, resolveWhen(selected, { region: "eu" }))).toEqual({
			allow: [0],
			deny: [1],
		});
	});
});

describe("what a binding remembers", () => {
	const rules = [
		rule("allow", { when: IN_EU }),
		rule("allow", { when: WITH_MFA }),
		rule("deny"),
	];

	it("answers every environment for itself, asked in any order", () => {
		const selected = selectionOf(rules);
		const eu = { region: "eu", mfa: false };
		const mfa = { region: "us", mfa: true };

		for (let round = 0; round < 2; round++) {
			expect(taking(rules, resolveWhen(selected, eu))).toEqual({
				allow: [0],
				deny: [2],
			});
			expect(taking(rules, resolveWhen(selected, mfa))).toEqual({
				allow: [1],
				deny: [2],
			});
			expect(taking(rules, resolveWhen(selected, { ...eu }))).toEqual({
				allow: [0],
				deny: [2],
			});
		}
	});
});

describe("the relations a resolved selection reaches", () => {
	const authorIsBanned: ConditionNode<Row> = {
		relation: "author",
		type: "one",
		where: { field: "role", op: "eq", value: "banned" },
	};

	it("are those of the rules that stay", () => {
		const rules = [
			rule("allow"),
			rule("deny", { where: authorIsBanned, when: IN_EU }),
		];
		const selected = selectionOf(rules);

		expect(resolveWhen(selected, { region: "us" }).reaches).toEqual([]);
		expect(resolveWhen(selected, { region: "eu" }).reaches).toEqual([
			{ relation: "author", kind: "one", through: [] },
		]);
	});
});
