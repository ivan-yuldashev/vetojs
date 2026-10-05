import { describe, expect, it } from "vitest";
import { buildAbility, withEnv } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import type { CheckedRule } from "../../src/model/index.js";

type Author = { id: string; role: string };
type Comment = { id: string; spam: boolean };
type Post = {
	id: string;
	title: string;
	status: string;
	views: number;
	secret: boolean;
	deletedAt: Date | null;
	tags: string[];
	spent: number;
	limit: number;
	author?: Author | null;
	comments?: Comment[] | null;
};
type Env = { hour: number; viaAgent: boolean };

const ac = defineAbilities({
	env: shape<Env>(),
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: {
				author: { resource: "user", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		user: { schema: shape<Author>(), actions: ["read"] },
		comment: { schema: shape<Comment>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);
const allowFields = allow as unknown as (
	action: string,
	target: Record<string, string[]>,
	options: { values: Record<string, unknown> },
) => CheckedRule;

const MISSING = Symbol("missing");
const ENV: Env = { hour: 10, viaAgent: false };

type Answer = "yes" | "no" | "unknown" | "throws";
type Case = [value: unknown, answer: Answer];

const show = (value: unknown): string => {
	if (value === MISSING) {
		return "missing";
	}

	if (typeof value === "number") {
		return Number.isNaN(value) ? "NaN" : String(value);
	}

	if (value instanceof Date) {
		return Number.isNaN(value.getTime())
			? "an invalid Date"
			: `Date(${value.getTime()})`;
	}

	if (value === undefined) {
		return "undefined";
	}

	return JSON.stringify(value);
};

const bound = (rules: CheckedRule[], env: unknown = ENV) =>
	withEnv(buildAbility(ac, rules), env as Env);

const decided = (run: () => boolean): boolean | "throws" => {
	try {
		return run();
	} catch (error) {
		if (error instanceof RelationNotLoadedError) {
			return "throws";
		}

		throw error;
	}
};

const opens = (answer: Answer, effect: "allow" | "deny") => {
	if (answer === "throws") {
		return "throws";
	}

	return effect === "allow" ? answer === "yes" : answer === "no";
};

const rows = (
	where: Record<string, unknown>,
	field: string,
	cases: Case[],
	extra: Record<string, unknown> = {},
) => {
	describe(`where ${JSON.stringify(where)}`, () => {
		for (const [value, answer] of cases) {
			const row =
				value === MISSING
					? { id: "p1", ...extra }
					: { id: "p1", ...extra, [field]: value };

			it(`on ${field} ${show(value)}: ${answer}, so an allow ${opens(answer, "allow") === true ? "grants" : "grants nothing"} and a deny ${opens(answer, "deny") === true ? "steps aside" : "refuses"}`, () => {
				const permission = bound([allow("read", "post", { where } as never)]);
				const prohibition = bound([
					allow("read", "post"),
					deny("read", "post", { where } as never),
				]);

				expect(
					decided(() => permission.can("read", "post", row as never)),
				).toBe(opens(answer, "allow"));
				expect(
					decided(() => prohibition.can("read", "post", row as never)),
				).toBe(opens(answer, "deny"));
			});
		}
	});
};

const payloads = (
	values: Record<string, unknown>,
	field: string,
	cases: Case[],
) => {
	const permission = () =>
		bound([allowFields("update", { post: [field, "title"] }, { values })]);
	const prohibition = () =>
		bound([
			allow("update", "post"),
			deny("update", "post", { values } as never),
		]);
	const row = { id: "p1" } as never;

	describe(`values ${JSON.stringify(values)}`, () => {
		it(`has nothing to decide about a write that leaves ${field} out`, () => {
			const data = { title: "t" };

			expect(
				permission().validatePayload("update", "post", row, data as never),
			).toEqual({ ok: true, data });
			expect(
				prohibition().validatePayload("update", "post", row, data as never),
			).toEqual({ ok: true, data });
		});

		for (const [value, answer] of cases) {
			const data = { [field]: value };

			it(`with ${field} ${show(value)} in the payload: ${answer}`, () => {
				expect(
					permission().validatePayload("update", "post", row, data as never),
				).toEqual(
					answer === "yes"
						? { ok: true, data }
						: {
								ok: false,
								violations: [{ field, reason: "value not permitted" }],
							},
				);
				expect(
					prohibition().validatePayload("update", "post", row, data as never),
				).toEqual(
					answer === "no"
						? { ok: true, data }
						: {
								ok: false,
								violations: [{ field, reason: "value denied" }],
							},
				);
			});
		}
	});
};

const environments = (
	when: Record<string, unknown>,
	key: string,
	cases: Case[],
) => {
	describe(`when ${JSON.stringify(when)}`, () => {
		for (const [value, answer] of cases) {
			const env: Record<string, unknown> = { ...ENV };

			if (value === MISSING) {
				delete env[key];
			} else {
				env[key] = value;
			}

			it(`with ${key} ${show(value)} in the environment: ${answer}`, () => {
				const permission = bound(
					[allow("read", "post", { when } as never)],
					env,
				);
				const prohibition = bound(
					[allow("read", "post"), deny("read", "post", { when } as never)],
					env,
				);

				expect(permission.can("read", "post", { id: "p1" } as never)).toBe(
					opens(answer, "allow"),
				);
				expect(prohibition.can("read", "post", { id: "p1" } as never)).toBe(
					opens(answer, "deny"),
				);
			});
		}
	});
};

const INVALID = new Date(Number.NaN);
const AS_TEXT = "1970-01-01T00:00:01.000Z";

describe("a field of the row", () => {
	rows({ status: "published" }, "status", [
		["published", "yes"],
		["draft", "no"],
		[null, "no"],
		[MISSING, "unknown"],
		[5, "unknown"],
		[true, "unknown"],
		[{}, "unknown"],
		[["published"], "unknown"],
	]);

	rows({ status: { ne: "published" } }, "status", [
		["published", "no"],
		["draft", "yes"],
		[null, "yes"],
		[MISSING, "unknown"],
		[5, "unknown"],
		[true, "unknown"],
		[{}, "unknown"],
		[["published"], "unknown"],
	]);

	rows({ status: { in: ["published", "draft"] } }, "status", [
		["published", "yes"],
		["draft", "yes"],
		[null, "no"],
		[MISSING, "unknown"],
		[5, "unknown"],
		[true, "unknown"],
		[{}, "unknown"],
		[["published"], "unknown"],
	]);

	rows({ status: { nin: ["published", "draft"] } }, "status", [
		["published", "no"],
		["draft", "no"],
		[null, "yes"],
		[MISSING, "unknown"],
		[5, "unknown"],
		[true, "unknown"],
		[{}, "unknown"],
		[["published"], "unknown"],
	]);

	rows({ views: { gt: 100 } }, "views", [
		[200, "yes"],
		[50, "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["200", "unknown"],
		[Number.NaN, "unknown"],
	]);

	rows({ views: 200 }, "views", [
		[200, "yes"],
		[50, "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["200", "unknown"],
		[Number.NaN, "unknown"],
	]);

	rows({ secret: true }, "secret", [
		[true, "yes"],
		[false, "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["true", "unknown"],
		[1, "unknown"],
	]);

	rows({ deletedAt: null }, "deletedAt", [
		[null, "yes"],
		[new Date(1000), "no"],
		[MISSING, "unknown"],
		[INVALID, "no"],
		[AS_TEXT, "no"],
	]);

	rows({ deletedAt: { ne: null } }, "deletedAt", [
		[null, "no"],
		[new Date(1000), "yes"],
		[MISSING, "unknown"],
		[INVALID, "yes"],
		[AS_TEXT, "yes"],
	]);

	rows({ deletedAt: { exists: true } }, "deletedAt", [
		[null, "no"],
		[new Date(1000), "yes"],
		[MISSING, "unknown"],
		[INVALID, "yes"],
		[AS_TEXT, "yes"],
	]);

	rows({ tags: { has: "x" } }, "tags", [
		[["x", "y"], "yes"],
		[["y"], "no"],
		[[], "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["x", "unknown"],
		[[5], "unknown"],
	]);

	rows({ tags: { hasAny: ["x"] } }, "tags", [
		[["x", "y"], "yes"],
		[["y"], "no"],
		[[], "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["x", "unknown"],
		[[5], "unknown"],
	]);

	rows({ tags: { hasAll: [] } }, "tags", [
		[["x", "y"], "yes"],
		[["y"], "yes"],
		[[], "yes"],
		[null, "no"],
		[MISSING, "unknown"],
		["x", "unknown"],
		[[5], "yes"],
	]);

	const SPENT: [value: unknown, lte: Answer, gt: Answer][] = [
		[50, "yes", "no"],
		[150, "no", "yes"],
		[null, "unknown", "unknown"],
		[MISSING, "unknown", "unknown"],
		["50", "unknown", "unknown"],
		[Number.NaN, "unknown", "unknown"],
	];

	rows(
		{ spent: { lte: { ref: "limit" } } },
		"spent",
		SPENT.map(([value, lte]) => [value, lte]),
		{ limit: 100 },
	);
	rows(
		{ spent: { gt: { ref: "limit" } } },
		"spent",
		SPENT.map(([value, , gt]) => [value, gt]),
		{ limit: 100 },
	);
});

describe("a field of a related row", () => {
	rows({ author: { role: "admin" } }, "author", [
		[{ id: "u1", role: "admin" }, "yes"],
		[{ id: "u1", role: "user" }, "no"],
		[{ id: "u1", role: null }, "no"],
		[{ id: "u1" }, "unknown"],
		[{ id: "u1", role: 5 }, "unknown"],
		[null, "no"],
		[MISSING, "throws"],
		["u1", "throws"],
		[true, "unknown"],
	]);

	const COMMENTS: [value: unknown, some: Answer, none: Answer][] = [
		[[{ id: "c1", spam: true }], "yes", "no"],
		[[{ id: "c1", spam: false }], "no", "yes"],
		[[], "no", "yes"],
		[null, "no", "yes"],
		[[{ id: "c1", spam: "true" }], "unknown", "unknown"],
		[[{ id: "c1" }], "unknown", "unknown"],
		[MISSING, "throws", "throws"],
		[["c1"], "throws", "throws"],
	];

	rows(
		{ comments: { some: { spam: true } } },
		"comments",
		COMMENTS.map(([value, some]) => [value, some]),
	);
	rows(
		{ comments: { none: { spam: true } } },
		"comments",
		COMMENTS.map(([value, , none]) => [value, none]),
	);
});

describe("a field of the payload", () => {
	payloads({ status: "draft" }, "status", [
		["draft", "yes"],
		["published", "no"],
		[null, "no"],
		[undefined, "unknown"],
		[5, "unknown"],
		[{}, "unknown"],
	]);

	payloads({ status: { ne: "published" } }, "status", [
		["draft", "yes"],
		["published", "no"],
		[null, "yes"],
		[undefined, "unknown"],
		[5, "unknown"],
		[{}, "unknown"],
	]);

	payloads({ deletedAt: null }, "deletedAt", [
		[null, "yes"],
		[new Date(1000), "no"],
		[undefined, "unknown"],
		[INVALID, "no"],
	]);
});

describe("a key of the environment", () => {
	environments({ hour: { gte: 9 } }, "hour", [
		[10, "yes"],
		[8, "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["10", "unknown"],
		[Number.NaN, "unknown"],
	]);

	environments({ viaAgent: true }, "viaAgent", [
		[true, "yes"],
		[false, "no"],
		[null, "no"],
		[MISSING, "unknown"],
		["true", "unknown"],
		[1, "unknown"],
	]);

	environments({ viaAgent: { ne: true } }, "viaAgent", [
		[true, "no"],
		[false, "yes"],
		[null, "yes"],
		[MISSING, "unknown"],
		["true", "unknown"],
		[1, "unknown"],
	]);
});
