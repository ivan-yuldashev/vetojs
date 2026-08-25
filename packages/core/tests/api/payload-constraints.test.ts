import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import { toVocabulary } from "../../src/api/vocabulary.js";

type Post = { id: string; status: string; views: number };

const ac = defineAbilities({
	resources: { post: { schema: shape<Post>(), actions: ["update"] } },
});

const { allow, deny } = createRules(ac);

const row: Post = { id: "p1", status: "secret", views: 5 };

const UNREADABLE = [
	{ or: [{ status: "secret" }] },
	{ not: { status: "secret" } },
	{ relation: "author", type: "one", where: { id: "u1" } },
	"garbage",
	42,
	null,
	[],
] as const;

const vetoed = (constraints: unknown): CheckedRules =>
	[
		{ effect: "allow", action: "update", resource: "post" },
		{
			effect: "deny",
			action: "update",
			resource: "post",
			payload: { constraints },
		},
	] as CheckedRules;

describe("a payload constraint that says nothing does not silence the rule", () => {
	describe("the shorthand refuses what it cannot read", () => {
		it("names what payload constraints take", () => {
			for (const constraints of UNREADABLE) {
				expect(() =>
					deny("update", "post", {
						payload: { constraints: constraints as never },
					}),
				).toThrow(/payload constraints take a field condition or "and"/);
			}
		});

		it("takes a field condition and an and, as it always did", () => {
			expect(
				deny("update", "post", {
					payload: { constraints: { status: "secret" } },
				}).payload?.constraints,
			).toEqual({ field: "status", op: "eq", value: "secret" });

			expect(
				deny("update", "post", {
					payload: { constraints: { and: [{ status: "secret" }] } },
				}).payload?.constraints,
			).toEqual({ and: [{ field: "status", op: "eq", value: "secret" }] });
		});

		it("leaves an empty shorthand carrying no constraint at all", () => {
			expect(
				deny("update", "post", { payload: { constraints: {} } }).payload,
			).toEqual({});
		});
	});

	describe("a rule that names no value stays a prohibition on the row", () => {
		it("refuses the row, as a deny with no payload would", () => {
			const empty = buildAbility(ac, [
				allow("update", "post"),
				deny("update", "post", { payload: {} }),
			]);

			const vacuous = buildAbility(ac, vetoed({ and: [] }));

			expect(vacuous.can("update", "post", row)).toBe(
				empty.can("update", "post", row),
			);
			expect(vacuous.can("update", "post", row)).toBe(false);
		});

		it("keeps the row out of the database filter too", () => {
			expect(
				buildAbility(ac, vetoed({ and: [] })).where("update", "post"),
			).toEqual({ or: [] });
		});

		it("refuses a write, rather than passing it", () => {
			const ability = buildAbility(ac, vetoed({ and: [] }));

			expect(
				ability.validatePayload("update", "post", row, { status: "any" }).ok,
			).toBe(false);
			expect(ability.canMutate("update", "post", row)).toBe(false);
		});

		it("reads the same whether the rule was written or parsed", () => {
			const parsed = parseRules(vetoed({ and: [] }), toVocabulary(ac));

			expect(parsed.ok).toBe(true);

			if (!parsed.ok) {
				return;
			}

			expect(buildAbility(ac, parsed.rules).can("update", "post", row)).toBe(
				false,
			);
		});
	});

	describe("a constraint that does say something still scopes the rule", () => {
		const scoped = buildAbility(ac, [
			allow("update", "post", { payload: { fields: ["status", "views"] } }),
			deny("update", "post", {
				payload: { constraints: { status: "secret" } },
			}),
		]);

		it("leaves the row readable", () => {
			expect(scoped.can("update", "post", row)).toBe(true);
		});

		it("refuses only the value it names", () => {
			expect(
				scoped.validatePayload("update", "post", row, { status: "secret" }).ok,
			).toBe(false);
			expect(
				scoped.validatePayload("update", "post", row, { status: "public" }).ok,
			).toBe(true);
		});

		it("stays out of the database filter, which is about rows", () => {
			expect(scoped.where("update", "post")).toEqual({ and: [] });
		});
	});

	describe("a field list alone still scopes the rule", () => {
		it("keeps the row readable and refuses the field", () => {
			const ability = buildAbility(ac, [
				allow("update", "post", { payload: { fields: ["status", "views"] } }),
				deny("update", "post", { payload: { fields: ["status"] } }),
			]);

			expect(ability.can("update", "post", row)).toBe(true);
			expect(
				ability.validatePayload("update", "post", row, { status: "x" }).ok,
			).toBe(false);
			expect(
				ability.validatePayload("update", "post", row, { views: 6 }).ok,
			).toBe(true);
		});
	});

	describe("the same emptiness arriving as a compiled rule", () => {
		it("does not turn a deny into silence", () => {
			for (const constraints of [{ and: [] }, undefined]) {
				const ability = buildAbility(ac, vetoed(constraints));

				expect(ability.can("update", "post", row)).toBe(false);
			}
		});
	});
});
