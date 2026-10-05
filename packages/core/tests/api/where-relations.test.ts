import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import {
	ForbiddenError,
	RelationNotLoadedError,
} from "../../src/errors/index.js";
import type { ConditionNode, Row } from "../../src/model/index.js";
import { markLoaded } from "../../src/row/index.js";
import { parseRules } from "../../src/validate/index.js";
import {
	type Answer,
	answerOf,
	FAILS,
	HOLDS,
	node,
	sparse,
} from "../verdict-of.js";

type Outcome = Answer | "throws";

type Case = [name: string, row: Row, outcome: Outcome];

class Entity {
	role = "admin";
	spam = true;
}

const author = (where: ConditionNode<Row>) =>
	({ relation: "author", type: "one", where }) as ConditionNode<Row>;

const comments = (match: string, where: ConditionNode<Row>) =>
	({ relation: "comments", type: "many", match, where }) as ConditionNode<Row>;

const post = (fields: Row): Row => ({ id: "p1", ...fields });

const relation = (
	title: string,
	condition: ConditionNode<Row>,
	cases: Case[],
) => {
	describe(title, () => {
		for (const [name, row, outcome] of cases) {
			it(`${name}: ${outcome === "throws" ? "throws" : `answers ${outcome}`}, alone and beside another condition`, () => {
				const beside: [ConditionNode<Row>, Outcome][] = [
					[condition, outcome],
					[{ and: [HOLDS, condition] }, outcome],
					[{ or: [FAILS, condition] }, outcome],
					[{ and: [FAILS, condition] }, outcome === "throws" ? "throws" : "no"],
					[{ or: [HOLDS, condition] }, outcome === "throws" ? "throws" : "yes"],
				];

				for (const [each, expected] of beside) {
					if (expected === "throws") {
						expect(() => answerOf(each, row)).toThrow(RelationNotLoadedError);
						continue;
					}

					expect(answerOf(each, row)).toBe(expected);
				}
			});
		}
	});
};

relation("a to-one relation", author(node("role", "eq", "admin")), [
	["an empty list where one row belongs", post({ author: [] }), "unknown"],
	[
		"a list with a hole where one row belongs",
		post({ author: sparse(1, {}) }),
		"unknown",
	],
	["an author who is an admin", post({ author: { role: "admin" } }), "yes"],
	["an author who is not", post({ author: { role: "user" } }), "no"],
	["an author without the field", post({ author: { id: "a1" } }), "unknown"],
	[
		"an author whose field holds another type",
		post({ author: { role: 5 } }),
		"unknown",
	],
	[
		"an author whose field is an object",
		post({ author: { role: {} } }),
		"unknown",
	],
	["null, loaded and empty", post({ author: null }), "no"],
	["marked loaded and empty", markLoaded(post({}), "author", null), "no"],
	["named loaded and empty", markLoaded(post({}), { author: null }), "no"],
	[
		"only another relation named loaded",
		markLoaded(post({}), { comments: [] }),
		"throws",
	],
	["absent, never loaded", post({}), "throws"],
	["an id where the row belongs", post({ author: "a1" }), "throws"],
	["a numeric id where the row belongs", post({ author: 7 }), "throws"],
	[
		"a list where one row belongs",
		post({ author: [{ role: "admin" }] }),
		"unknown",
	],
	["a class instance", post({ author: new Entity() }), "unknown"],
	["a Date", post({ author: new Date(0) }), "unknown"],
]);

relation("a to-one relation asked for null", author(node("role", "eq", null)), [
	["an author whose field is null", post({ author: { role: null } }), "yes"],
	["an author whose field is set", post({ author: { role: "admin" } }), "no"],
	["an author without the field", post({ author: { id: "a1" } }), "unknown"],
	["null, loaded and empty", post({ author: null }), "no"],
	["absent, never loaded", post({}), "throws"],
]);

relation(
	"a to-many relation asked whether any row differs from null",
	comments("some", node("spam", "ne", null)),
	[
		["a row whose field is set", post({ comments: [{ spam: false }] }), "yes"],
		["a row whose field is null", post({ comments: [{ spam: null }] }), "no"],
		["a row without the field", post({ comments: [{}] }), "unknown"],
		[
			"a row without the field beside a set one",
			post({ comments: [{}, { spam: true }] }),
			"yes",
		],
		["an empty list", post({ comments: [] }), "no"],
	],
);

relation(
	"a to-many relation with some",
	comments("some", node("spam", "eq", true)),
	[
		[
			"a row lacking the field beside a match",
			post({ comments: [{}, { spam: true }] }),
			"yes",
		],
		[
			"a row beside an id",
			post({ comments: [{ spam: true }, "c2"] }),
			"throws",
		],
		[
			"a hole before a match",
			post({ comments: sparse(2, { 1: { spam: true } }) }),
			"unknown",
		],
		[
			"a hole between a miss and a match",
			post({ comments: sparse(3, { 0: { spam: false }, 2: { spam: true } }) }),
			"unknown",
		],
		["a list of holes", post({ comments: sparse(2, {}) }), "unknown"],
		[
			"undefined beside a match",
			post({ comments: [undefined, { spam: true }] }),
			"unknown",
		],
		[
			"a list inside the list",
			post({ comments: [[{ spam: true }]] }),
			"unknown",
		],
		[
			"one match among others",
			post({ comments: [{ spam: false }, { spam: true }] }),
			"yes",
		],
		["no match", post({ comments: [{ spam: false }] }), "no"],
		["an empty list", post({ comments: [] }), "no"],
		["null, loaded and empty", post({ comments: null }), "no"],
		["marked loaded and empty", markLoaded(post({}), "comments", null), "no"],
		[
			"named loaded as an empty list",
			markLoaded(post({}), { comments: [] }),
			"no",
		],
		["a row without the field", post({ comments: [{}] }), "unknown"],
		[
			"a row whose field holds another type",
			post({ comments: [{ spam: "true" }] }),
			"unknown",
		],
		[
			"a row whose field is an object",
			post({ comments: [{ spam: {} }] }),
			"unknown",
		],
		[
			"an unknown row beside a match",
			post({ comments: [{ spam: {} }, { spam: true }] }),
			"yes",
		],
		[
			"an unknown row beside a miss",
			post({ comments: [{ spam: {} }, { spam: false }] }),
			"unknown",
		],
		["absent, never loaded", post({}), "throws"],
		["ids where rows belong", post({ comments: ["c1", "c2"] }), "throws"],
		[
			"one row where a list belongs",
			post({ comments: { spam: true } }),
			"unknown",
		],
		["a list holding null", post({ comments: [null] }), "unknown"],
		[
			"a list holding a class instance",
			post({ comments: [new Entity()] }),
			"unknown",
		],
	],
);

relation(
	"a to-many relation with every",
	comments("every", node("spam", "eq", true)),
	[
		[
			"one row lacks the field",
			post({ comments: [{ spam: true }, {}] }),
			"unknown",
		],
		[
			"a hole between a miss and a match",
			post({ comments: sparse(3, { 0: { spam: false }, 2: { spam: true } }) }),
			"unknown",
		],
		["a list of holes", post({ comments: sparse(2, {}) }), "unknown"],
		[
			"a list inside the list",
			post({ comments: [[{ spam: true }]] }),
			"unknown",
		],
		[
			"every row matches",
			post({ comments: [{ spam: true }, { spam: true }] }),
			"yes",
		],
		[
			"one row does not",
			post({ comments: [{ spam: true }, { spam: false }] }),
			"no",
		],
		["an empty list", post({ comments: [] }), "yes"],
		["null, loaded and empty", post({ comments: null }), "yes"],
		[
			"an unknown row beside matches",
			post({ comments: [{ spam: true }, { spam: {} }] }),
			"unknown",
		],
		[
			"an unknown row beside a miss",
			post({ comments: [{ spam: false }, { spam: {} }] }),
			"no",
		],
		["absent, never loaded", post({}), "throws"],
		[
			"one row where a list belongs",
			post({ comments: { spam: true } }),
			"unknown",
		],
	],
);

relation(
	"a to-many relation with none",
	comments("none", node("spam", "eq", true)),
	[
		[
			"a row lacking the field beside a miss",
			post({ comments: [{ spam: false }, {}] }),
			"unknown",
		],
		[
			"a hole beside a match",
			post({ comments: sparse(2, { 1: { spam: true } }) }),
			"unknown",
		],
		["a list of holes", post({ comments: sparse(2, {}) }), "unknown"],
		["no row matches", post({ comments: [{ spam: false }] }), "yes"],
		[
			"a row whose field holds another type",
			post({ comments: [{ spam: "true" }] }),
			"unknown",
		],
		[
			"one row matches",
			post({ comments: [{ spam: false }, { spam: true }] }),
			"no",
		],
		["an empty list", post({ comments: [] }), "yes"],
		["null, loaded and empty", post({ comments: null }), "yes"],
		["only an unknown row", post({ comments: [{ spam: {} }] }), "unknown"],
		[
			"an unknown row beside a match",
			post({ comments: [{ spam: true }, { spam: {} }] }),
			"no",
		],
		["absent, never loaded", post({}), "throws"],
	],
);

relation(
	"a relation inside a relation",
	comments("some", author(node("banned", "eq", true))),
	[
		[
			"an author loaded on the first comment and never on the second",
			post({ comments: [{ author: { banned: true } }, {}] }),
			"throws",
		],
		[
			"an author never loaded on the first comment and loaded on the second",
			post({ comments: [{}, { author: { banned: true } }] }),
			"throws",
		],
		[
			"a hole among the comments",
			post({ comments: sparse(2, { 1: { author: { banned: true } } }) }),
			"unknown",
		],
		[
			"a comment by a banned author",
			post({ comments: [{ author: { banned: true } }] }),
			"yes",
		],
		[
			"a comment by an author in good standing",
			post({ comments: [{ author: { banned: false } }] }),
			"no",
		],
		["a comment with no author", post({ comments: [{ author: null }] }), "no"],
		[
			"one banned author among others",
			post({
				comments: [{ author: { banned: false } }, { author: { banned: true } }],
			}),
			"yes",
		],
		["no comments", post({ comments: [] }), "no"],
		[
			"a comment whose author was never loaded",
			post({ comments: [{}] }),
			"throws",
		],
		[
			"a comment carrying the author's id",
			post({ comments: [{ author: "a1" }] }),
			"throws",
		],
		["comments never loaded", post({}), "throws"],
	],
);

relation(
	"an or inside a to-one relation",
	author({ or: [node("role", "eq", "admin"), node("karma", "gt", 10)] }),
	[
		[
			"the second branch holds",
			post({ author: { role: "user", karma: 11 } }),
			"yes",
		],
		[
			"the first holds and the second is broken",
			post({ author: { role: "admin", karma: "x" } }),
			"yes",
		],
		[
			"the first fails and the second is broken",
			post({ author: { role: "user", karma: "x" } }),
			"unknown",
		],
		["both fail", post({ author: { role: "user", karma: 1 } }), "no"],
	],
);

relation(
	"an and inside a to-many relation",
	comments("some", {
		and: [node("spam", "eq", false), node("score", "gt", 5)],
	}),
	[
		[
			"the row that passes one lacks the other",
			post({ comments: [{ spam: false }] }),
			"unknown",
		],
		[
			"the row lacks the first and passes the second",
			post({ comments: [{ score: 6 }] }),
			"unknown",
		],
		[
			"an incomplete row before a complete one",
			post({ comments: [{ spam: false }, { spam: false, score: 6 }] }),
			"yes",
		],
		[
			"a broken row before a complete one",
			post({
				comments: [
					{ spam: false, score: "x" },
					{ spam: false, score: 6 },
				],
			}),
			"yes",
		],
		[
			"a broken row beside a row that fails",
			post({ comments: [{ spam: false, score: "x" }, { spam: true }] }),
			"unknown",
		],
		[
			"one row satisfies both",
			post({ comments: [{ spam: false, score: 6 }] }),
			"yes",
		],
		[
			"each row satisfies only one",
			post({
				comments: [
					{ spam: false, score: 4 },
					{ spam: true, score: 9 },
				],
			}),
			"no",
		],
		[
			"the row that passes one has the other broken",
			post({ comments: [{ spam: false, score: "x" }] }),
			"unknown",
		],
		[
			"the row that fails one has the other broken",
			post({ comments: [{ spam: true, score: "x" }] }),
			"no",
		],
	],
);

relation(
	"a not inside a to-many relation with every",
	comments("every", { not: node("spam", "eq", true) }),
	[
		["no row is spam", post({ comments: [{ spam: false }] }), "yes"],
		[
			"one row is spam",
			post({ comments: [{ spam: false }, { spam: true }] }),
			"no",
		],
		["a row is broken", post({ comments: [{ spam: {} }] }), "unknown"],
		["no rows", post({ comments: [] }), "yes"],
	],
);

relation(
	"an or inside a to-many relation that reaches another relation",
	comments("some", {
		or: [node("score", "gt", 5), author(node("role", "eq", "admin"))],
	}),
	[
		[
			"a low score by an admin",
			post({ comments: [{ score: 1, author: { role: "admin" } }] }),
			"yes",
		],
		[
			"a low score by a user",
			post({ comments: [{ score: 1, author: { role: "user" } }] }),
			"no",
		],
		[
			"a low score with the author never loaded",
			post({ comments: [{ score: 1 }] }),
			"throws",
		],
		[
			"a high score with the author never loaded",
			post({ comments: [{ score: 9 }] }),
			"throws",
		],
	],
);

relation(
	"a relation beside a field in an or",
	{
		or: [
			node("status", "eq", "published"),
			author(node("role", "eq", "admin")),
		],
	},
	[
		[
			"the field holds and the author is not an admin",
			post({ status: "published", author: { role: "user" } }),
			"yes",
		],
		[
			"the field fails and the author is an admin",
			post({ status: "draft", author: { role: "admin" } }),
			"yes",
		],
		[
			"the field holds and the author was never loaded",
			post({ status: "published" }),
			"throws",
		],
	],
);

relation(
	"a not over a to-one relation",
	{ not: author(node("banned", "eq", true)) },
	[
		["an author in good standing", post({ author: { banned: false } }), "yes"],
		["a banned author", post({ author: { banned: true } }), "no"],
		["no author", post({ author: null }), "yes"],
		[
			"an author whose field is broken",
			post({ author: { banned: {} } }),
			"unknown",
		],
	],
);

relation(
	"an array field on a related row",
	comments("some", node("tags", "has", "x")),
	[
		[
			"a row whose array holds the element",
			post({ comments: [{ tags: ["x"] }] }),
			"yes",
		],
		["a row whose array does not", post({ comments: [{ tags: ["y"] }] }), "no"],
		[
			"a row whose array holds it after a hole",
			post({ comments: [{ tags: sparse(2, { 1: "x" }) }] }),
			"yes",
		],
		[
			"a row whose array is only holes",
			post({ comments: [{ tags: sparse(2, {}) }] }),
			"no",
		],
		[
			"a row whose field is not an array",
			post({ comments: [{ tags: "x" }] }),
			"unknown",
		],
		["a row without the field", post({ comments: [{}] }), "unknown"],
		["a row whose field is null", post({ comments: [{ tags: null }] }), "no"],
	],
);

relation(
	"every element of a list on a to-one relation",
	author(node("tags", "hasAll", ["a", "b"])),
	[
		["an array holding both", post({ author: { tags: ["a", "b"] } }), "yes"],
		[
			"an array holding both around a hole",
			post({ author: { tags: sparse(3, { 0: "a", 2: "b" }) } }),
			"yes",
		],
		["an array holding one", post({ author: { tags: ["a"] } }), "no"],
		[
			"an array holding one and an object",
			post({ author: { tags: ["a", {}] } }),
			"unknown",
		],
	],
);

relation(
	"every row asked to differ, one of them incomplete",
	comments("every", node("status", "ne", "spam")),
	[
		[
			"every row differs",
			post({ comments: [{ status: "ok" }, { status: "new" }] }),
			"yes",
		],
		[
			"one row lacks the field",
			post({ comments: [{ status: "ok" }, {}] }),
			"unknown",
		],
		[
			"one row lacks it and another is spam",
			post({ comments: [{}, { status: "spam" }] }),
			"no",
		],
		[
			"one row's field is broken",
			post({ comments: [{ status: "ok" }, { status: {} }] }),
			"unknown",
		],
	],
);

relation(
	"a relation on a to-one related row",
	author({
		relation: "team",
		type: "one",
		where: node("id", "eq", "t1"),
	} as ConditionNode<Row>),
	[
		[
			"the author's team is loaded and matches",
			post({ author: { team: { id: "t1" } } }),
			"yes",
		],
		[
			"the author's team is loaded and does not",
			post({ author: { team: { id: "t2" } } }),
			"no",
		],
		["the author has no team", post({ author: { team: null } }), "no"],
		[
			"the author is loaded, the team never was",
			post({ author: { role: "admin" } }),
			"throws",
		],
	],
);

relation(
	"several conditions on a to-one relation",
	author({ and: [node("role", "eq", "admin"), node("karma", "gt", 10)] }),
	[
		["both hold", post({ author: { role: "admin", karma: 11 } }), "yes"],
		[
			"the first holds and the second is absent",
			post({ author: { role: "admin" } }),
			"unknown",
		],
		[
			"the first holds and the second is broken",
			post({ author: { role: "admin", karma: "x" } }),
			"unknown",
		],
		[
			"the first fails and the second is absent",
			post({ author: { role: "user" } }),
			"no",
		],
		[
			"the first fails and the second is broken",
			post({ author: { role: "user", karma: "x" } }),
			"no",
		],
		[
			"the first is absent and the second holds",
			post({ author: { karma: 11 } }),
			"unknown",
		],
		[
			"the first is broken and the second holds",
			post({ author: { role: {}, karma: 11 } }),
			"unknown",
		],
		["both are absent", post({ author: {} }), "unknown"],
		["both are broken", post({ author: { role: {}, karma: "x" } }), "unknown"],
	],
);

relation(
	"several conditions on every related row",
	comments("every", {
		and: [node("spam", "eq", false), node("score", "gt", 5)],
	}),
	[
		[
			"every row holds both",
			post({
				comments: [
					{ spam: false, score: 6 },
					{ spam: false, score: 7 },
				],
			}),
			"yes",
		],
		[
			"one row lacks the second",
			post({ comments: [{ spam: false, score: 6 }, { spam: false }] }),
			"unknown",
		],
		[
			"one row has the second broken",
			post({
				comments: [
					{ spam: false, score: 6 },
					{ spam: false, score: "x" },
				],
			}),
			"unknown",
		],
		[
			"a broken row beside a row that fails",
			post({
				comments: [
					{ spam: false, score: "x" },
					{ spam: true, score: 6 },
				],
			}),
			"no",
		],
	],
);

relation(
	"several conditions on no related row",
	comments("none", {
		and: [node("spam", "eq", false), node("score", "gt", 5)],
	}),
	[
		[
			"no row holds both",
			post({ comments: [{ spam: true, score: 6 }] }),
			"yes",
		],
		["a row holds both", post({ comments: [{ spam: false, score: 6 }] }), "no"],
		[
			"a row lacks the second",
			post({ comments: [{ spam: false }] }),
			"unknown",
		],
		[
			"a row has the second broken",
			post({ comments: [{ spam: false, score: "x" }] }),
			"unknown",
		],
		[
			"a broken row beside a row that holds both",
			post({
				comments: [
					{ spam: false, score: "x" },
					{ spam: false, score: 6 },
				],
			}),
			"no",
		],
	],
);

relation(
	"an or on a to-one relation whose first branches refuse",
	author({
		or: [
			node("role", "eq", "admin"),
			node("karma", "gt", 10),
			node("banned", "eq", false),
		],
	}),
	[
		[
			"the first two fail and the third holds",
			post({ author: { role: "user", karma: 1, banned: false } }),
			"yes",
		],
		[
			"the second is absent and the third holds",
			post({ author: { role: "user", banned: false } }),
			"yes",
		],
		[
			"the first two are broken and the third holds",
			post({ author: { role: {}, karma: "x", banned: false } }),
			"yes",
		],
		[
			"only the third is present, and holds",
			post({ author: { banned: false } }),
			"yes",
		],
		[
			"the second is broken and the others fail",
			post({ author: { role: "user", karma: "x", banned: true } }),
			"unknown",
		],
		[
			"all three fail",
			post({ author: { role: "user", karma: 1, banned: true } }),
			"no",
		],
	],
);

relation(
	"an or on every related row, each row passing by another branch",
	comments("every", {
		or: [node("spam", "eq", false), node("score", "gt", 5)],
	}),
	[
		[
			"one row by the first branch, the other by the second",
			post({ comments: [{ spam: false }, { spam: true, score: 9 }] }),
			"yes",
		],
		[
			"a row whose first branch is broken passes by the second",
			post({ comments: [{ spam: {}, score: 9 }] }),
			"yes",
		],
		[
			"one row passes by neither",
			post({
				comments: [
					{ spam: true, score: 9 },
					{ spam: true, score: 1 },
				],
			}),
			"no",
		],
		[
			"one row has the first failing and the second broken",
			post({ comments: [{ spam: true, score: "x" }, { spam: false }] }),
			"unknown",
		],
	],
);

relation(
	"an or on no related row, a later branch matching",
	comments("none", { or: [node("spam", "eq", true), node("score", "gt", 5)] }),
	[
		[
			"no row matches either branch",
			post({ comments: [{ spam: false, score: 1 }] }),
			"yes",
		],
		[
			"a row matches by the second branch",
			post({ comments: [{ spam: false, score: 9 }] }),
			"no",
		],
		[
			"a row with the first broken matches by the second",
			post({ comments: [{ spam: {}, score: 9 }] }),
			"no",
		],
		[
			"a row with the first broken and the second failing",
			post({ comments: [{ spam: {}, score: 1 }] }),
			"unknown",
		],
	],
);

relation(
	"an or across relations and a field whose first branches refuse",
	{
		or: [
			author(node("role", "eq", "admin")),
			comments("some", node("spam", "eq", true)),
			node("status", "eq", "published"),
		],
	},
	[
		[
			"the relations fail and the field holds",
			post({
				author: { role: "user" },
				comments: [{ spam: false }],
				status: "published",
			}),
			"yes",
		],
		[
			"the author fails and the comments hold",
			post({
				author: { role: "user" },
				comments: [{ spam: true }],
				status: "draft",
			}),
			"yes",
		],
		[
			"both relations are empty and the field holds",
			post({ author: null, comments: [], status: "published" }),
			"yes",
		],
		[
			"the author is broken and the field holds",
			post({
				author: { role: {} },
				comments: [{ spam: false }],
				status: "published",
			}),
			"yes",
		],
		[
			"every branch fails",
			post({
				author: { role: "user" },
				comments: [{ spam: false }],
				status: "draft",
			}),
			"no",
		],
		[
			"the author is broken and the rest fail",
			post({
				author: { role: {} },
				comments: [{ spam: false }],
				status: "draft",
			}),
			"unknown",
		],
		[
			"the author was never loaded and a later branch holds",
			post({ comments: [{ spam: true }], status: "published" }),
			"throws",
		],
	],
);

describe("relations a serializer dropped", () => {
	const banned = comments("some", author(node("role", "eq", "banned")));
	const stripped = post({ comments: [{ id: "c1" }] });

	it("throws until the dropped relation is named loaded", () => {
		expect(() => answerOf(banned, stripped)).toThrow(RelationNotLoadedError);
		expect(
			answerOf(banned, markLoaded(stripped, { comments: [{ author: null }] })),
		).toBe("no");
	});

	it("throws for a relation inside a list that was not named", () => {
		expect(() =>
			answerOf(banned, markLoaded(stripped, { comments: [] })),
		).toThrow(RelationNotLoadedError);
	});

	it("reads the rows that were there", () => {
		const row = post({
			comments: [{ id: "c1" }, { author: { role: "banned" } }],
		});

		expect(
			answerOf(banned, markLoaded(row, { comments: [{ author: null }] })),
		).toBe("yes");
	});
});

describe("two relations, one of them loaded", () => {
	it("throws for the one never loaded, naming it", () => {
		const condition = {
			and: [
				author(node("role", "eq", "user")),
				comments("some", node("spam", "eq", true)),
			],
		};
		const row = post({ author: { role: "admin" } });

		expect(() => answerOf(condition, row)).toThrow(RelationNotLoadedError);

		try {
			answerOf(condition, row);
		} catch (error) {
			expect(error).toMatchObject({ relation: "comments" });
		}
	});

	it("throws for one never loaded under not or or, after the rest settled", () => {
		const row = post({ status: "draft" });
		const unloaded = author(node("role", "eq", "admin"));

		for (const condition of [
			{ and: [node("status", "eq", "published"), { not: unloaded }] },
			{ or: [node("status", "eq", "draft"), unloaded] },
			{
				or: [node("status", "eq", "draft"), { not: { or: [FAILS, unloaded] } }],
			},
		]) {
			expect(() => answerOf(condition, row)).toThrow(RelationNotLoadedError);
		}
	});
});

describe("a relation node the rule itself gets wrong", () => {
	it("is refused when it arrives from outside", () => {
		const refused: [where: unknown, message: string][] = [
			[
				{ relation: "comments", type: "many", where: node("spam", "eq", true) },
				'expected "some" | "every" | "none" for a to-many relation',
			],
			[
				{
					relation: "author",
					type: "one",
					match: "some",
					where: node("role", "eq", "admin"),
				},
				"a to-one relation must not carry a match",
			],
			[{ relation: "author", type: "one" }, "where: missing"],
			[
				{
					relation: "author",
					type: "several",
					where: node("role", "eq", "admin"),
				},
				'expected "one" | "many"',
			],
		];

		for (const [where, message] of refused) {
			expect(
				parseRules([
					{ effect: "deny", action: "update", resource: "post", where },
				]),
			).toEqual({ ok: false, errors: [expect.stringContaining(message)] });
		}
	});

	it("answers unknown for a quantifier nobody knows if one gets past", () => {
		const row = post({ comments: [{ spam: true }] });

		expect(answerOf(comments("most", node("spam", "eq", true)), row)).toBe(
			"unknown",
		);
		expect(
			answerOf({ not: comments("most", node("spam", "eq", true)) }, row),
		).toBe("unknown");
	});
});

describe("relations written in the shorthand", () => {
	type Author = { id: string; role: string; banned: boolean };
	type Comment = { id: string; spam: boolean; author?: Author | null };
	type Post = {
		id: string;
		status: string;
		author?: Author | null;
		comments?: Comment[] | null;
	};

	const ac = defineAbilities({
		resources: {
			post: {
				schema: shape<Post>(),
				actions: ["read", "update", "delete"],
				relations: {
					author: { resource: "author", kind: "one" },
					comments: { resource: "comment", kind: "many" },
				},
			},
			comment: {
				schema: shape<Comment>(),
				actions: ["read"],
				relations: { author: { resource: "author", kind: "one" } },
			},
			author: { schema: shape<Author>(), actions: ["read"] },
		},
	});

	const { allow, deny } = createRules(ac);

	const admin: Author = { id: "a1", role: "admin", banned: false };
	const user: Author = { id: "a2", role: "user", banned: false };
	const banned: Author = { id: "a3", role: "user", banned: true };

	it("does not compile a relation written wrong", () => {
		const written = () => [
			// @ts-expect-error a to-many relation says how many rows must match
			allow("read", "post", { where: { comments: { spam: true } } }),
			// @ts-expect-error a to-one relation takes no quantifier
			allow("read", "post", { where: { author: { some: { role: "admin" } } } }),
			// @ts-expect-error an author has no score
			allow("read", "post", { where: { author: { score: 1 } } }),
			// @ts-expect-error post declares no editor
			allow("read", "post", { where: { editor: { role: "admin" } } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("grants and prohibits through relations as the tree does", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: { author: { role: "admin" } } }),
			deny("update", "post", {
				where: { comments: { some: { author: { banned: true } } } },
			}),
		]);

		expect(
			ability.can("update", "post", {
				id: "p1",
				status: "draft",
				author: admin,
				comments: [],
			}),
		).toBe(true);
		expect(
			ability.can("update", "post", {
				id: "p1",
				status: "draft",
				author: user,
				comments: [],
			}),
		).toBe(false);
		expect(
			ability.can("update", "post", {
				id: "p1",
				status: "draft",
				author: admin,
				comments: [{ id: "c1", spam: false, author: banned }],
			}),
		).toBe(false);
		expect(() =>
			ability.can("update", "post", {
				id: "p1",
				status: "draft",
				author: admin,
			}),
		).toThrow(RelationNotLoadedError);
	});

	it("stays open for can without a row and refuses the deciding calls", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: { author: { role: "admin" } } }),
		]);

		expect(ability.can("update", "post")).toBe(true);
		expect(() => ability.authorize("update", "post")).toThrow(ForbiddenError);
		expect(ability.canMutate("update", "post")).toBe(false);
	});

	it("carries a relation condition to every action under manage", () => {
		const ability = buildAbility(ac, [
			allow("manage", "post", { where: { author: { role: "admin" } } }),
			deny("delete", "post", {
				where: { comments: { some: { spam: true } } },
			}),
		]);
		const clean = { id: "p1", status: "draft", author: admin, comments: [] };
		const spammed = {
			...clean,
			comments: [{ id: "c1", spam: true, author: user }],
		};

		expect(ability.can("read", "post", clean)).toBe(true);
		expect(ability.can("delete", "post", clean)).toBe(true);
		expect(ability.can("delete", "post", spammed)).toBe(false);
		expect(ability.can("update", "post", spammed)).toBe(true);
		expect(ability.can("delete", "post", { ...clean, author: user })).toBe(
			false,
		);
	});
});
