import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { ConditionNode, Row } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";
import { type Answer, answerOf, node } from "../verdict-of.js";

const row = { id: "p1", status: "draft", authorId: "u1", views: "abc" };

const Y = node("status", "eq", "draft");
const N = node("status", "eq", "published");
const U = node("views", "gt", 10);

describe("and, or and not over three answers", () => {
	const table: [name: string, condition: ConditionNode<Row>, answer: Answer][] =
		[
			["and of yes and yes", { and: [Y, Y] }, "yes"],
			["and of yes and no", { and: [Y, N] }, "no"],
			["and of no and yes", { and: [N, Y] }, "no"],
			["and of yes and unknown", { and: [Y, U] }, "unknown"],
			["and of unknown and yes", { and: [U, Y] }, "unknown"],
			["and of no and unknown", { and: [N, U] }, "no"],
			["and of unknown and no", { and: [U, N] }, "no"],
			["and of unknown and unknown", { and: [U, U] }, "unknown"],
			["or of yes and no", { or: [Y, N] }, "yes"],
			["or of no and yes", { or: [N, Y] }, "yes"],
			["or of no and no", { or: [N, N] }, "no"],
			["or of no and unknown", { or: [N, U] }, "unknown"],
			["or of unknown and no", { or: [U, N] }, "unknown"],
			["or of yes and unknown", { or: [Y, U] }, "yes"],
			["or of unknown and yes", { or: [U, Y] }, "yes"],
			["or of unknown and unknown", { or: [U, U] }, "unknown"],
			["not of yes", { not: Y }, "no"],
			["not of no", { not: N }, "yes"],
			["not of unknown", { not: U }, "unknown"],
		];

	for (const [name, condition, answer] of table) {
		it(`${name} is ${answer}`, () => {
			expect(answerOf(condition, row)).toBe(answer);
		});
	}
});

describe("nested groups", () => {
	const table: [name: string, condition: ConditionNode<Row>, answer: Answer][] =
		[
			["an or inside an and", { and: [{ or: [N, Y] }, Y] }, "yes"],
			[
				"two ands inside an or",
				{ or: [{ and: [Y, N] }, { and: [Y, Y] }] },
				"yes",
			],
			["not over an and with an unknown", { not: { and: [Y, U] } }, "unknown"],
			["not over an or with an unknown", { not: { or: [N, U] } }, "unknown"],
			["not over an or of two noes", { not: { or: [N, N] } }, "yes"],
			["not over not", { not: { not: Y } }, "yes"],
			[
				"three levels: and, or, and with a not",
				{ and: [Y, { or: [N, { and: [Y, { not: N }] }] }] },
				"yes",
			],
			[
				"an unknown and-branch beside a no in an or",
				{ or: [{ and: [U, Y] }, { not: Y }] },
				"unknown",
			],
			[
				"an unknown and-branch beside a yes in an or",
				{ or: [{ and: [U, Y] }, { not: N }] },
				"yes",
			],
			[
				"four levels of single children",
				{ and: [{ or: [{ and: [{ or: [Y] }] }] }] },
				"yes",
			],
			[
				"four levels ending in an unknown",
				{ and: [{ or: [{ and: [{ or: [U] }] }] }] },
				"unknown",
			],
		];

	for (const [name, condition, answer] of table) {
		it(`${name} is ${answer}`, () => {
			expect(answerOf(condition, row)).toBe(answer);
		});
	}
});

describe("one condition holds and the data for the other is missing", () => {
	const full = { id: "p1", status: "draft" };

	it("answers no under and when the missing field cannot exceed anything", () => {
		expect(answerOf({ and: [Y, node("views", "gt", 10)] }, full)).toBe("no");
	});

	it("answers unknown under and when the other field holds the wrong type", () => {
		expect(answerOf({ and: [Y, U] }, row)).toBe("unknown");
	});

	it("answers yes under and when the missing field is asked to differ", () => {
		expect(answerOf({ and: [Y, node("authorId", "ne", "u2")] }, full)).toBe(
			"yes",
		);
	});

	it("answers no under or when the other branch fails and the field is missing", () => {
		expect(answerOf({ or: [N, node("views", "gt", 10)] }, full)).toBe("no");
	});

	it("answers yes under or when one branch holds, whatever the other lacks", () => {
		expect(answerOf({ or: [Y, U] }, row)).toBe("yes");
		expect(answerOf({ or: [Y, node("views", "gt", 10)] }, full)).toBe("yes");
	});
});

describe("an empty group", () => {
	it("is refused when it arrives from outside", () => {
		for (const empty of [{ and: [] }, { or: [] }]) {
			expect(
				parseRules([
					{ effect: "allow", action: "update", resource: "post", where: empty },
				]),
			).toEqual({
				ok: false,
				errors: [expect.stringContaining("expected at least one condition")],
			});
		}
	});

	it("reads an empty and as always and an empty or as never if one gets past", () => {
		expect(answerOf({ and: [] }, row)).toBe("yes");
		expect(answerOf({ or: [] }, row)).toBe("no");
		expect(answerOf({ not: { or: [] } }, row)).toBe("yes");
	});
});

describe("the shorthand", () => {
	type Post = { id: string; status: string; authorId: string; views: number };

	const ac = defineAbilities({
		resources: {
			post: { schema: shape<Post>(), actions: ["update"] },
		},
	});

	const { allow, deny } = createRules(ac);

	const answerFor = (rule: ReturnType<typeof allow>, target: Post): Answer => {
		const where = rule.where;

		if (where === undefined) {
			throw new Error("the rule carries no where");
		}

		return answerOf(where, target);
	};

	const mine: Post = { id: "p1", status: "draft", authorId: "u1", views: 5 };
	const theirs: Post = { id: "p2", status: "draft", authorId: "u2", views: 50 };

	it("reads sibling keys as and", () => {
		const rule = allow("update", "post", {
			where: { status: "draft", authorId: "u1" },
		});

		expect(answerFor(rule, mine)).toBe("yes");
		expect(answerFor(rule, theirs)).toBe("no");
	});

	it("reads or, not and nested groups as the tree does", () => {
		const rule = deny("update", "post", {
			where: {
				or: [
					{ authorId: "u2" },
					{ and: [{ views: { gt: 100 } }, { not: { status: "draft" } }] },
				],
			},
		});

		expect(answerFor(rule, mine)).toBe("no");
		expect(answerFor(rule, theirs)).toBe("yes");
		expect(answerFor(rule, { ...mine, views: 500, status: "published" })).toBe(
			"yes",
		);
		expect(answerFor(rule, { ...mine, views: 500 })).toBe("no");
	});

	it("does not compile an empty group", () => {
		const written = () => [
			// @ts-expect-error an or names at least one branch
			allow("update", "post", { where: { or: [] } }),
			// @ts-expect-error nor does an and
			allow("update", "post", { where: { and: [] } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("selects in where() the rows can() allows", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", {
				where: { or: [{ authorId: "u1" }, { views: { gt: 10 } }] },
			}),
			deny("update", "post", { where: { not: { status: "draft" } } }),
		]);

		expect(ability.can("update", "post", mine)).toBe(true);
		expect(ability.can("update", "post", theirs)).toBe(true);
		expect(
			ability.can("update", "post", { ...theirs, status: "published" }),
		).toBe(false);
		expect(ability.can("update", "post", { ...theirs, views: 1 })).toBe(false);
		expect(ability.where("update", "post")).toEqual({
			and: [
				{
					or: [
						{ field: "authorId", op: "eq", value: "u1" },
						{ field: "views", op: "gt", value: 10 },
					],
				},
				{ not: { not: { field: "status", op: "eq", value: "draft" } } },
			],
		});
	});
});

describe("an or whose first branches refuse and a later one holds", () => {
	const A = node("title", "gt", "a");

	const table: [name: string, condition: ConditionNode<Row>, answer: Answer][] =
		[
			["no, no, then yes", { or: [N, N, Y] }, "yes"],
			["unknown, then yes", { or: [U, Y] }, "yes"],
			["an absent field, then yes", { or: [A, Y] }, "yes"],
			["no, unknown, then yes", { or: [N, U, Y] }, "yes"],
			["unknown, no, then yes", { or: [U, N, Y] }, "yes"],
			["an absent field, unknown, no, then yes", { or: [A, U, N, Y] }, "yes"],
			["no, an absent field, then unknown", { or: [N, A, U] }, "unknown"],
			["no three times", { or: [N, N, N] }, "no"],
			["an absent field twice", { or: [A, A] }, "no"],
			[
				"an and that fails, an and that is unknown, then an and that holds",
				{ or: [{ and: [Y, N] }, { and: [Y, U] }, { and: [Y, Y] }] },
				"yes",
			],
			["two nots, the second holding", { or: [{ not: Y }, { not: N }] }, "yes"],
		];

	for (const [name, condition, answer] of table) {
		it(`${name} is ${answer}`, () => {
			expect(answerOf(condition, row)).toBe(answer);
		});
	}
});
