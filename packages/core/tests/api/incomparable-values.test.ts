import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import { evaluateCondition } from "../../src/evaluation/index.js";

type Txn = {
	id: string;
	amount: number;
	riskScore: number;
	expiresAt: Date;
};

const ac = defineAbilities({
	resources: {
		txn: { schema: shape<Txn>(), actions: ["read", "update"] },
	},
});

const { allow, deny } = createRules(ac);

const ORDERING = ["gt", "gte", "lt", "lte"] as const;

const sound: Txn = {
	id: "t1",
	amount: 5000,
	riskScore: 10,
	expiresAt: new Date("2026-01-01T00:00:00Z"),
};

const withAmount = (amount: unknown): Txn =>
	({ ...sound, amount }) as unknown as Txn;

const guarded = (op: (typeof ORDERING)[number], value: unknown) =>
	buildAbility(ac, [
		allow("update", "txn"),
		{
			effect: "deny",
			action: "update",
			resource: "txn",
			where: { field: "amount", op, value },
		},
	] as CheckedRules);

const granted = (op: (typeof ORDERING)[number], value: unknown) =>
	buildAbility(ac, [
		{
			effect: "allow",
			action: "update",
			resource: "txn",
			where: { field: "amount", op, value },
		},
	] as CheckedRules);

describe("a value no comparison can settle", () => {
	describe("no prohibition steps aside for it", () => {
		it("fires every ordering deny on NaN", () => {
			for (const op of ORDERING) {
				expect(
					guarded(op, 1000).can("update", "txn", withAmount(Number.NaN)),
				).toBe(false);
			}
		});

		it("fires every ordering deny on an invalid date", () => {
			for (const op of ORDERING) {
				expect(
					guarded(op, 0).can(
						"update",
						"txn",
						withAmount(new Date("not-a-date")),
					),
				).toBe(false);
			}
		});

		it("fires when the rule itself carries the unusable value", () => {
			for (const op of ORDERING) {
				expect(guarded(op, Number.NaN).can("update", "txn", sound)).toBe(false);
			}
		});

		it("leaves no gap between two halves that cover the whole line", () => {
			const row = withAmount(Number.NaN);
			const over = guarded("gt", 1000).can("update", "txn", row);
			const under = guarded("lte", 1000).can("update", "txn", row);

			expect([over, under]).not.toEqual([true, true]);
			expect([over, under]).toEqual([false, false]);
		});

		it("fires a deny reaching for the far end of the range", () => {
			expect(
				guarded("gt", Number.NEGATIVE_INFINITY).can(
					"update",
					"txn",
					withAmount(Number.NaN),
				),
			).toBe(false);
		});
	});

	describe("no grant is handed out for it either", () => {
		it("grants nothing on NaN", () => {
			for (const op of ORDERING) {
				expect(
					granted(op, 1000).can("update", "txn", withAmount(Number.NaN)),
				).toBe(false);
			}
		});

		it("grants nothing on an invalid date", () => {
			for (const op of ORDERING) {
				expect(
					granted(op, 0).can(
						"update",
						"txn",
						withAmount(new Date("not-a-date")),
					),
				).toBe(false);
			}
		});

		it("keeps the answer unknown rather than false, so a not cannot flip it", () => {
			const node = { field: "amount", op: "gt", value: 1000 } as const;
			const row = withAmount(Number.NaN);

			expect(evaluateCondition(node, row)).toBeUndefined();
			expect(evaluateCondition({ not: node }, row)).toBeUndefined();
			expect(
				buildAbility(ac, [
					{
						effect: "allow",
						action: "update",
						resource: "txn",
						where: { not: node },
					},
				] as CheckedRules).can("update", "txn", row),
			).toBe(false);
		});
	});

	describe("what a comparison can still settle", () => {
		it("answers a sound row exactly as before", () => {
			expect(guarded("gt", 1000).can("update", "txn", sound)).toBe(false);
			expect(guarded("lte", 1000).can("update", "txn", sound)).toBe(true);
			expect(granted("gt", 1000).can("update", "txn", sound)).toBe(true);
			expect(granted("lt", 1000).can("update", "txn", sound)).toBe(false);
		});

		it("keeps a missing or null field a decidable non-match", () => {
			const missing = { id: "t2" } as unknown as Txn;
			const empty = withAmount(null);

			expect(guarded("gt", 1000).can("update", "txn", missing)).toBe(true);
			expect(guarded("gt", 1000).can("update", "txn", empty)).toBe(true);
			expect(granted("gt", 1000).can("update", "txn", missing)).toBe(false);
		});

		it("keeps the infinities comparable", () => {
			expect(
				guarded("gt", 1000).can(
					"update",
					"txn",
					withAmount(Number.POSITIVE_INFINITY),
				),
			).toBe(false);
			expect(
				guarded("gt", 1000).can(
					"update",
					"txn",
					withAmount(Number.NEGATIVE_INFINITY),
				),
			).toBe(true);
		});

		it("keeps a valid date comparable", () => {
			const ability = buildAbility(ac, [
				allow("read", "txn"),
				deny("read", "txn", {
					where: { expiresAt: { lt: new Date("2025-01-01T00:00:00Z") } },
				}),
			]);

			expect(ability.can("read", "txn", sound)).toBe(true);
			expect(
				ability.can("read", "txn", {
					...sound,
					expiresAt: new Date("2024-01-01T00:00:00Z"),
				}),
			).toBe(false);
		});

		it("keeps a string against a number unknown, as it always was", () => {
			expect(guarded("gt", 1000).can("update", "txn", withAmount("5000"))).toBe(
				false,
			);
		});
	});

	describe("the same value arriving by other doors", () => {
		it("cannot be smuggled in as a payload value", () => {
			const ability = buildAbility(ac, [
				allow("update", "txn", {
					payload: { fields: ["amount"], constraints: { amount: { lt: 100 } } },
				}),
			]);

			expect(
				ability.validatePayload("update", "txn", sound, {
					amount: Number.NaN,
				}).ok,
			).toBe(false);
			expect(
				ability.validatePayload("update", "txn", sound, { amount: 50 }).ok,
			).toBe(true);
		});

		it("cannot pass a mutation check either", () => {
			const ability = guarded("gt", 1000);

			expect(ability.canMutate("update", "txn", withAmount(Number.NaN))).toBe(
				false,
			);
			expect(ability.canMutate("update", "txn", withAmount(10))).toBe(true);
		});

		it("does not change what the database filter asks for", () => {
			const ability = guarded("gt", 1000);

			expect(ability.where("update", "txn")).toEqual({
				not: { field: "amount", op: "gt", value: 1000 },
			});
		});

		it("still answers the row-less question optimistically", () => {
			expect(guarded("gt", 1000).can("update", "txn")).toBe(true);
		});
	});
});
