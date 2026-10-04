import { describe, expect, it } from "vitest";
import type { Ability, Decision } from "../../src/api/index.js";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import {
	ForbiddenError,
	RelationNotLoadedError,
} from "../../src/errors/index.js";
import type { CheckedRule } from "../../src/model/index.js";

type Author = { id: string; role: string };
type Comment = { id: string; spam: boolean };
type Post = {
	id: string;
	authorId: string;
	status: string;
	title: string;
	views: number;
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
		author: { schema: shape<Author>(), actions: ["read"] },
		comment: { schema: shape<Comment>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const mine: Post = {
	id: "p1",
	authorId: "u1",
	status: "draft",
	title: "a",
	views: 20,
	author: { id: "a1", role: "admin" },
	comments: [],
};
const theirs: Post = {
	...mine,
	id: "p2",
	authorId: "u2",
	author: { id: "a2", role: "user" },
};
const locked: Post = { ...mine, status: "locked" };
const spammed: Post = { ...mine, comments: [{ id: "c1", spam: true }] };
const broken = { ...mine, views: "abc" } as unknown as Post;

class Entity {
	id = "p1";
	authorId = "u1";
}

const notPlain = new Entity() as unknown as Post;

const grant = allow("update", "post");
const blanket = deny("update", "post");
const managing = allow("manage", "post");
const noManaging = deny("manage", "post");
const listed = allow(["read", "update"], "post");
const titleOnly = allow("update", { post: ["title"] });
const noTitle = deny("update", { post: ["title"] });
const mineOnly = allow("update", "post", { where: { authorId: "u1" } });
const lockedOut = deny("update", "post", { where: { status: "locked" } });
const busyOnly = allow("update", "post", { where: { views: { gt: 10 } } });
const draftOnly = allow("update", "post", { where: { status: "draft" } });
const busyOut = deny("update", "post", { where: { views: { gt: 10 } } });
const quietOut = deny("update", "post", { where: { views: { lt: 5 } } });
const byAdmin = allow("update", "post", {
	where: { author: { role: "admin" } },
});
const noSpam = deny("update", "post", {
	where: { comments: { some: { spam: true } } },
});
const draftsWritten = allow("update", "post", { values: { status: "draft" } });
const noArchive = deny("update", "post", { values: { status: "archived" } });

type Report = Omit<Decision, "action" | "resource">;

const granted = (rule: CheckedRule): Report => ({ allowed: true, rule });
const refused = (rule?: CheckedRule): Report =>
	rule === undefined ? { allowed: false } : { allowed: false, rule };
const notARow: Report = { allowed: false, reason: "not a plain row" };

const watched = (rules: CheckedRule[]) => {
	const seen: Decision[] = [];
	const ability = buildAbility(ac, rules, {
		onDecision: (decision) => {
			seen.push(decision);
		},
	});

	const heard = <T>(ask: (asked: Ability) => T) => {
		seen.length = 0;

		const answer = ask(ability as Ability);

		return { answer, reports: [...seen] };
	};

	return heard;
};

const throwsForbidden = (run: () => void): boolean => {
	try {
		run();
		return false;
	} catch (error) {
		if (ForbiddenError.is(error)) {
			return true;
		}

		throw error;
	}
};

type RowCase = {
	name: string;
	rules: CheckedRule[];
	row: Post | undefined;
	advisory: Report;
	deciding: Report;
};

const withRow = (
	name: string,
	rules: CheckedRule[],
	row: Post,
	report: Report,
): RowCase => ({ name, rules, row, advisory: report, deciding: report });

const withoutRow = (
	name: string,
	rules: CheckedRule[],
	advisory: Report,
	deciding: Report,
): RowCase => ({ name, rules, row: undefined, advisory, deciding });

const rowCases: [level: string, cases: RowCase[]][] = [
	[
		"the resource",
		[
			withRow("an allow grants", [grant], mine, granted(grant)),
			withoutRow("an allow grants", [grant], granted(grant), granted(grant)),
			withRow("a deny overrides it", [grant, blanket], mine, refused(blanket)),
			withoutRow(
				"a deny overrides it",
				[grant, blanket],
				refused(blanket),
				refused(blanket),
			),
			withRow("nothing names the pair", [], mine, refused()),
			withoutRow("nothing names the pair", [], refused(), refused()),
			withRow(
				"only another action is named",
				[allow("read", "post")],
				mine,
				refused(),
			),
			withRow("manage grants", [managing], mine, granted(managing)),
			withRow(
				"a deny written as manage overrides",
				[grant, noManaging],
				mine,
				refused(noManaging),
			),
			withRow("a list grants", [listed], mine, granted(listed)),
			withRow(
				"two allows grant, the first written is named",
				[grant, managing],
				mine,
				granted(grant),
			),
			withRow(
				"two allows grant, the other written first",
				[managing, grant],
				mine,
				granted(managing),
			),
			withRow(
				"two denies fire, the first written is named",
				[grant, blanket, noManaging],
				mine,
				refused(blanket),
			),
			withRow(
				"two denies fire, the other written first",
				[grant, noManaging, blanket],
				mine,
				refused(noManaging),
			),
			withRow("the row is not a plain object", [grant], notPlain, notARow),
		],
	],
	[
		"fields",
		[
			withRow(
				"a field allow grants the row",
				[titleOnly],
				mine,
				granted(titleOnly),
			),
			withoutRow(
				"a field allow grants the row",
				[titleOnly],
				granted(titleOnly),
				granted(titleOnly),
			),
			withRow(
				"a field deny leaves the row to the allow",
				[grant, noTitle],
				mine,
				granted(grant),
			),
			withRow("a field deny alone grants nothing", [noTitle], mine, refused()),
		],
	],
	[
		"conditions",
		[
			withRow(
				"an allow whose condition holds",
				[mineOnly],
				mine,
				granted(mineOnly),
			),
			withRow("an allow whose condition fails", [mineOnly], theirs, refused()),
			withoutRow(
				"an allow that needs the row",
				[mineOnly],
				granted(mineOnly),
				refused(),
			),
			withRow(
				"a deny whose condition holds",
				[grant, lockedOut],
				locked,
				refused(lockedOut),
			),
			withRow(
				"a deny whose condition fails",
				[grant, lockedOut],
				mine,
				granted(grant),
			),
			withoutRow(
				"a deny that needs the row",
				[grant, lockedOut],
				granted(grant),
				refused(),
			),
			withoutRow(
				"a blanket deny beside an allow that needs the row",
				[mineOnly, blanket],
				refused(blanket),
				refused(blanket),
			),
			withRow("an allow whose field is broken", [busyOnly], broken, refused()),
			withRow(
				"a deny whose field is broken fires and is named",
				[grant, busyOut],
				broken,
				refused(busyOut),
			),
			withRow(
				"a broken allow beside a broken deny names the deny",
				[busyOnly, busyOut],
				broken,
				refused(busyOut),
			),
			withRow(
				"two broken denies, the first written is named",
				[grant, busyOut, quietOut],
				broken,
				refused(busyOut),
			),
			withRow(
				"two broken denies, the other written first",
				[grant, quietOut, busyOut],
				broken,
				refused(quietOut),
			),
			withRow(
				"a deny that settled is named over a broken one written first",
				[grant, busyOut, lockedOut],
				{ ...locked, views: "abc" } as unknown as Post,
				refused(lockedOut),
			),
			withRow(
				"one allow is broken and another holds",
				[busyOnly, draftOnly],
				broken,
				granted(draftOnly),
			),
			withRow("the row is not a plain object", [mineOnly], notPlain, notARow),
		],
	],
	[
		"relations",
		[
			withRow(
				"an allow through a relation holds",
				[byAdmin],
				mine,
				granted(byAdmin),
			),
			withRow(
				"an allow through a relation fails",
				[byAdmin],
				theirs,
				refused(),
			),
			withoutRow(
				"an allow through a relation needs the row",
				[byAdmin],
				granted(byAdmin),
				refused(),
			),
			withRow(
				"a deny through a relation fires",
				[grant, noSpam],
				spammed,
				refused(noSpam),
			),
			withRow(
				"a deny through a relation stays quiet",
				[grant, noSpam],
				mine,
				granted(grant),
			),
			withRow(
				"a deny through a relation of the wrong shape fires and is named",
				[grant, noSpam],
				{ ...mine, comments: { id: "c1", spam: true } } as unknown as Post,
				refused(noSpam),
			),
		],
	],
	[
		"values",
		[
			withRow(
				"a values allow grants the row",
				[draftsWritten],
				mine,
				granted(draftsWritten),
			),
			withRow(
				"a values deny leaves the row to the allow",
				[grant, noArchive],
				mine,
				granted(grant),
			),
			withRow(
				"a values deny alone grants nothing",
				[noArchive],
				mine,
				refused(),
			),
		],
	],
];

for (const [level, cases] of rowCases) {
	describe(`what a question about the row reports, on ${level}`, () => {
		for (const { name, rules, row, advisory, deciding } of cases) {
			it(`${name} ${row === undefined ? "without a row" : "with a row"}`, () => {
				const heard = watched(rules);
				const at = { action: "update", resource: "post" };

				const can = heard((ability) => ability.can("update", "post", row));
				const cannot = heard((ability) =>
					ability.cannot("update", "post", row),
				);
				const authorize = heard((ability) =>
					throwsForbidden(() => ability.authorize("update", "post", row)),
				);
				const canMutate = heard((ability) =>
					ability.canMutate("update", "post", row),
				);

				expect(can).toEqual({
					answer: advisory.allowed,
					reports: [{ ...at, ...advisory }],
				});
				expect(cannot).toEqual({
					answer: !advisory.allowed,
					reports: [{ ...at, ...advisory }],
				});
				expect(authorize).toEqual({
					answer: !deciding.allowed,
					reports: [{ ...at, ...deciding }],
				});
				expect(canMutate).toEqual({
					answer: deciding.allowed,
					reports: [{ ...at, ...deciding }],
				});
			});
		}
	});
}

describe("what a question that never reaches a decision reports", () => {
	it("names no rule for a question about manage", () => {
		const heard = watched([managing]);

		expect(heard((ability) => ability.can("manage", "post", mine))).toEqual({
			answer: false,
			reports: [{ action: "manage", resource: "post", allowed: false }],
		});
	});

	it("reports nothing when a relation that was never loaded stops the check", () => {
		const seen: Decision[] = [];
		const ability = buildAbility(ac, [byAdmin], {
			onDecision: (decision) => {
				seen.push(decision);
			},
		});
		const { author: _author, ...unloaded } = mine;

		expect(() => ability.can("update", "post", unloaded)).toThrow(
			RelationNotLoadedError,
		);
		expect(() => ability.authorize("update", "post", unloaded)).toThrow(
			RelationNotLoadedError,
		);
		expect(seen).toEqual([]);
	});

	it("reports nothing for the questions that are not decisions", () => {
		const heard = watched([grant, noTitle]);

		expect(heard((ability) => ability.where("update", "post")).reports).toEqual(
			[],
		);
		expect(
			heard((ability) =>
				ability.permittedFields("update", "post", mine, ["title"]),
			).reports,
		).toEqual([]);
		expect(heard((ability) => ability.validate("post", mine)).reports).toEqual(
			[],
		);
	});
});

type PayloadCase = {
	name: string;
	rules: CheckedRule[];
	row: Post | undefined;
	data: Record<string, unknown>;
	report: Report;
};

const payloadCases: PayloadCase[] = [
	{
		name: "a write that passes",
		rules: [grant],
		row: mine,
		data: { title: "t" },
		report: { allowed: true },
	},
	{
		name: "a write under a blanket deny",
		rules: [grant, blanket],
		row: mine,
		data: { title: "t" },
		report: { allowed: false, violations: [] },
	},
	{
		name: "a write nothing permits",
		rules: [],
		row: mine,
		data: { title: "t" },
		report: { allowed: false, violations: [] },
	},
	{
		name: "a write to a row the condition does not reach",
		rules: [mineOnly],
		row: theirs,
		data: { title: "t" },
		report: { allowed: false, violations: [] },
	},
	{
		name: "a write whose row was not passed, under an allow that needs it",
		rules: [mineOnly],
		row: undefined,
		data: { title: "t" },
		report: { allowed: false, violations: [] },
	},
	{
		name: "a write to a row that is not a plain object",
		rules: [grant],
		row: notPlain,
		data: { title: "t" },
		report: { allowed: false, violations: [], reason: "not a plain row" },
	},
	{
		name: "a write of data that is not a plain object",
		rules: [grant],
		row: mine,
		data: "text" as unknown as Record<string, unknown>,
		report: { allowed: false, violations: [] },
	},
	{
		name: "a field the allow does not name",
		rules: [titleOnly],
		row: mine,
		data: { status: "draft" },
		report: {
			allowed: false,
			violations: [{ field: "status", reason: "field not permitted" }],
		},
	},
	{
		name: "a field a deny names",
		rules: [grant, noTitle],
		row: mine,
		data: { title: "t" },
		report: {
			allowed: false,
			violations: [{ field: "title", reason: "field not permitted" }],
		},
	},
	{
		name: "a value the allow does not permit",
		rules: [draftsWritten],
		row: mine,
		data: { status: "archived" },
		report: {
			allowed: false,
			violations: [{ field: "status", reason: "value not permitted" }],
		},
	},
	{
		name: "a value a deny takes",
		rules: [grant, noArchive],
		row: mine,
		data: { status: "archived" },
		report: {
			allowed: false,
			violations: [{ field: "status", reason: "value denied" }],
		},
	},
	{
		name: "every reason at once, in the order the data names them",
		rules: [
			allow(
				"update",
				{ post: ["status", "views"] },
				{ values: { views: { lte: 10 } } },
			),
			noArchive,
		],
		row: mine,
		data: { title: "t", status: "archived", views: 50 },
		report: {
			allowed: false,
			violations: [
				{ field: "title", reason: "field not permitted" },
				{ field: "status", reason: "value denied" },
				{ field: "views", reason: "value not permitted" },
			],
		},
	},
];

describe("what a write reports", () => {
	for (const { name, rules, row, data, report } of payloadCases) {
		it(name, () => {
			const heard = watched(rules);
			const { answer, reports } = heard((ability) =>
				ability.validatePayload("update", "post", row, data),
			);

			expect(reports).toEqual([
				{ action: "update", resource: "post", ...report },
			]);
			expect(answer.ok).toBe(report.allowed);
			expect(answer.ok ? undefined : answer.violations).toEqual(
				report.violations,
			);
		});
	}
});

describe("every report agrees with its answer", () => {
	const vocabulary: CheckedRule[] = [
		grant,
		blanket,
		managing,
		noManaging,
		titleOnly,
		noTitle,
		mineOnly,
		lockedOut,
		byAdmin,
		noSpam,
		draftsWritten,
		noArchive,
	];

	const policies = [
		...vocabulary.map((rule) => [rule]),
		...vocabulary.flatMap((first) =>
			vocabulary.map((second) => [first, second]),
		),
	];

	const rows: (Post | undefined)[] = [
		mine,
		theirs,
		locked,
		spammed,
		broken,
		notPlain,
		undefined,
	];

	it("for every pair of rules, every row and every call", () => {
		for (const rules of policies) {
			const heard = watched(rules);

			for (const row of rows) {
				const isPlain = row !== notPlain;
				const calls = [
					heard((ability) => ({ allowed: ability.can("update", "post", row) })),
					heard((ability) => ({
						allowed: !ability.cannot("update", "post", row),
					})),
					heard((ability) => ({
						allowed: !throwsForbidden(() =>
							ability.authorize("update", "post", row),
						),
					})),
					heard((ability) => ({
						allowed: ability.canMutate("update", "post", row),
					})),
				];

				for (const { answer, reports } of calls) {
					const [report] = reports;

					expect(reports).toHaveLength(1);
					expect(report?.allowed).toBe(answer.allowed);
					expect(report?.violations).toBeUndefined();
					expect(report?.reason).toBe(isPlain ? undefined : "not a plain row");

					if (report?.rule !== undefined) {
						expect(rules).toContain(report.rule);
						expect(report.rule.effect).toBe(answer.allowed ? "allow" : "deny");
					}
				}

				const { answer, reports } = heard((ability) =>
					ability.validatePayload("update", "post", row, {
						title: "t",
						status: "archived",
					}),
				);
				const [report] = reports;

				expect(reports).toHaveLength(1);
				expect(report?.allowed).toBe(answer.ok);
				expect(report?.rule).toBeUndefined();
				expect(report?.violations).toEqual(
					answer.ok ? undefined : answer.violations,
				);
				expect(report?.reason).toBe(isPlain ? undefined : "not a plain row");
			}
		}
	});
});
