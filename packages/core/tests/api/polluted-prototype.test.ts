import { afterEach, describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import { toVocabulary } from "../../src/api/vocabulary.js";

type Post = { id: string; authorId: string; views: number };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const mine: Post = { id: "p1", authorId: "me", views: 1 };
const yours: Post = { id: "p2", authorId: "victim", views: 1 };

const POLLUTED: [string, unknown][] = [
	["and", []],
	["or", []],
	["not", {}],
	["relation", "author"],
	["match", "some"],
	["where", {}],
	["field", "authorId"],
	["op", "eq"],
	["value", "victim"],
	["type", "one"],
	["fields", ["authorId"]],
	["constraints", {}],
	["effect", "allow"],
	["action", "read"],
	["resource", "post"],
];

const under = <T>(key: string, value: unknown, run: () => T): T => {
	(Object.prototype as Record<string, unknown>)[key] = value;

	try {
		return run();
	} finally {
		delete (Object.prototype as Record<string, unknown>)[key];
	}
};

const forEachPollution = <T>(run: () => T): [string, T][] =>
	POLLUTED.map(([key, value]) => [key, under(key, value, run)]);

afterEach(() => {
	for (const [key] of POLLUTED) {
		delete (Object.prototype as Record<string, unknown>)[key];
	}
});

describe("a polluted prototype does not reshape a condition", () => {
	describe("an owner rule keeps refusing a foreign row", () => {
		it("refuses under every key the engine dispatches on", () => {
			const answers = forEachPollution(() =>
				buildAbility(ac, [
					allow("read", "post", { where: { authorId: "me" } }),
				]).can("read", "post", yours),
			);

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, false]));
		});

		it("still grants the row that does match", () => {
			const answers = forEachPollution(() =>
				buildAbility(ac, [
					allow("read", "post", { where: { authorId: "me" } }),
				]).can("read", "post", mine),
			);

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, true]));
		});

		it("neither throws nor recurses without end", () => {
			const outcomes = forEachPollution(() => {
				try {
					buildAbility(ac, [
						allow("read", "post", { where: { authorId: "me" } }),
					]).can("read", "post", yours);

					return "answered";
				} catch (error) {
					return `threw ${(error as Error).constructor.name}`;
				}
			});

			expect(outcomes).toEqual(POLLUTED.map(([key]) => [key, "answered"]));
		});
	});

	describe("a prohibition keeps prohibiting", () => {
		it("fires under every pollution", () => {
			const answers = forEachPollution(() =>
				buildAbility(ac, [
					allow("read", "post"),
					deny("read", "post", { where: { authorId: "victim" } }),
				]).can("read", "post", yours),
			);

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, false]));
		});

		it("keeps a payload-scoped deny scoped to the payload", () => {
			const answers = under("fields", ["authorId"], () => {
				const ability = buildAbility(ac, [
					allow("update", "post", { payload: { fields: ["views"] } }),
					deny("update", "post", { payload: { fields: ["authorId"] } }),
				]);

				return {
					row: ability.can("update", "post", mine),
					permitted: ability.validatePayload("update", "post", mine, {
						views: 2,
					}).ok,
					refused: ability.validatePayload("update", "post", mine, {
						authorId: "x",
					}).ok,
				};
			});

			expect(answers).toEqual({ row: true, permitted: true, refused: false });
		});
	});

	describe("the trust gate reads the same shapes", () => {
		it("accepts a sound rule and keeps its condition", () => {
			const answers = forEachPollution(() => {
				const result = parseRules(
					[
						{
							effect: "allow",
							action: "read",
							resource: "post",
							where: { field: "authorId", op: "eq", value: "me" },
						},
					] as CheckedRules,
					toVocabulary(ac),
				);

				return result.ok
					? buildAbility(ac, result.rules).can("read", "post", yours)
					: "refused the rule";
			});

			expect(answers).toEqual(POLLUTED.map(([key]) => [key, false]));
		});
	});

	describe("the condition handed to a database is unchanged", () => {
		it("still carries the owner condition", () => {
			const filter = under("and", [], () =>
				JSON.stringify(
					buildAbility(ac, [
						allow("read", "post", { where: { authorId: "me" } }),
					]).where("read", "post"),
				),
			);

			expect(filter).toBe('{"field":"authorId","op":"eq","value":"me"}');
		});
	});

	describe("the prototype is left as it was found", () => {
		it("carries nothing after the suite", () => {
			for (const [key] of POLLUTED) {
				expect(Object.prototype).not.toHaveProperty(key);
			}
		});
	});
});
