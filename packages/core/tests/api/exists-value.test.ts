import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import { toVocabulary } from "../../src/api/vocabulary.js";

type Post = { id: string; deletedAt: string | null; views: number };

const ac = defineAbilities({
	resources: { post: { schema: shape<Post>(), actions: ["read", "update"] } },
});

const { allow } = createRules(ac);

const NOT_BOOLEANS = ["false", "0", "true", "", 0, 1, [], {}, null] as const;

const present: Post = { id: "p1", deletedAt: "2026-01-01", views: 3 };
const absent = { id: "p2", views: 3 } as Post;

const asked = (value: unknown, effect: "allow" | "deny" = "allow") =>
	[
		...(effect === "deny"
			? [{ effect: "allow", action: "read", resource: "post" }]
			: []),
		{
			effect,
			action: "read",
			resource: "post",
			where: { field: "deletedAt", op: "exists", value },
		},
	] as CheckedRules;

describe("exists takes a boolean, and only a boolean", () => {
	describe("the trust gate turns the rest away", () => {
		it("names the field and the operator for every non-boolean", () => {
			for (const value of NOT_BOOLEANS) {
				const result = parseRules(asked(value), toVocabulary(ac));

				expect(result.ok).toBe(false);

				if (result.ok) {
					continue;
				}

				expect(result.errors.join(" ")).toMatch(
					/expected a boolean for "exists"/,
				);
			}
		});

		it("accepts the two values it does take", () => {
			expect(parseRules(asked(true), toVocabulary(ac)).ok).toBe(true);
			expect(parseRules(asked(false), toVocabulary(ac)).ok).toBe(true);
		});

		it("still refuses a missing value, as before", () => {
			const result = parseRules(
				[
					{
						effect: "allow",
						action: "read",
						resource: "post",
						where: { field: "deletedAt", op: "exists" },
					},
				] as CheckedRules,
				toVocabulary(ac),
			);

			expect(result.ok).toBe(false);
		});
	});

	describe("a rule that got past the gate answers unknown, not the opposite", () => {
		it("grants nothing, whichever way the row falls", () => {
			for (const value of NOT_BOOLEANS) {
				const ability = buildAbility(ac, asked(value));

				expect(ability.can("read", "post", present)).toBe(false);
				expect(ability.can("read", "post", absent)).toBe(false);
			}
		});

		it("makes a prohibition fire rather than step aside", () => {
			for (const value of NOT_BOOLEANS) {
				const ability = buildAbility(ac, asked(value, "deny"));

				expect(ability.can("read", "post", present)).toBe(false);
				expect(ability.can("read", "post", absent)).toBe(false);
			}
		});

		it("never reads the string 'false' as the boolean true", () => {
			const inverted = buildAbility(ac, asked("false"));
			const written = buildAbility(ac, asked(false));

			expect(written.can("read", "post", absent)).toBe(true);
			expect(inverted.can("read", "post", absent)).toBe(false);
			expect(inverted.can("read", "post", present)).toBe(false);
		});
	});

	describe("what the operator still answers", () => {
		it("asks about presence, not truthiness of the row's value", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { deletedAt: { exists: true } } }),
			]);

			expect(ability.can("read", "post", present)).toBe(true);
			expect(ability.can("read", "post", { ...present, deletedAt: null })).toBe(
				false,
			);
			expect(ability.can("read", "post", absent)).toBe(false);
			expect(
				buildAbility(ac, [
					allow("read", "post", { where: { views: { exists: true } } }),
				]).can("read", "post", { ...absent, views: 0 }),
			).toBe(true);
		});

		it("reads false as 'the field is not there'", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { deletedAt: { exists: false } } }),
			]);

			expect(ability.can("read", "post", absent)).toBe(true);
			expect(ability.can("read", "post", present)).toBe(false);
		});

		it("hands the database the same condition it always did", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { deletedAt: { exists: false } } }),
			]);

			expect(ability.where("read", "post")).toEqual({
				field: "deletedAt",
				op: "exists",
				value: false,
			});
		});
	});
});
