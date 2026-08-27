import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";

type User = { id: string; role: string };

type Loose = Record<string, unknown>;

const ac = defineAbilities({
	resources: {
		user: { schema: shape<User>(), actions: ["update"] },
		loose: { schema: shape<Loose>(), actions: ["update"] },
	},
});

const { allow } = createRules(ac);

const row: User = { id: "u1", role: "user" };

const RISKY = ["__proto__", "constructor", "prototype"] as const;

const fromWire = (key: string): Record<string, unknown> =>
	JSON.parse(`{"role":"admin","${key}":{"isAdmin":true}}`) as Record<
		string,
		unknown
	>;

describe("a payload naming what every object inherits", () => {
	describe("is refused, whatever the policy leaves open", () => {
		it("names each one as a violation when no rule lists any field", () => {
			const ability = buildAbility(ac, [allow("update", "user")]);

			for (const key of RISKY) {
				const result = ability.validatePayload(
					"update",
					"user",
					row,
					fromWire(key) as Partial<User>,
				);

				expect(result.ok).toBe(false);

				if (result.ok) {
					continue;
				}

				expect(result.violations).toEqual([
					{ field: key, reason: "field not permitted" },
				]);
			}
		});

		it("refuses it when a rule lists other fields", () => {
			const ability = buildAbility(ac, [
				allow("update", "user", { payload: { fields: ["role"] } }),
			]);

			for (const key of RISKY) {
				expect(
					ability.validatePayload(
						"update",
						"user",
						row,
						fromWire(key) as Partial<User>,
					).ok,
				).toBe(false);
			}
		});

		it("keeps it out of the fields a form may render", () => {
			const ability = buildAbility(ac, [allow("update", "user")]);

			expect(
				ability.permittedFields("update", "user", [
					"role",
					...RISKY,
				] as (keyof User)[]),
			).toEqual(["role"]);
		});

		it("leaves the prototype untouched after all of it", () => {
			expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
			expect(Object.prototype).not.toHaveProperty("isAdmin");
		});
	});

	describe("is refused even when a rule names it", () => {
		const ability = buildAbility(ac, [
			allow("update", "loose", { payload: { fields: ["role", ...RISKY] } }),
		]);

		it("grants no write for any of them", () => {
			for (const key of RISKY) {
				expect(
					ability.validatePayload("update", "loose", row, fromWire(key)).ok,
				).toBe(false);
			}
		});

		it("offers none of them to a form", () => {
			expect(
				ability.permittedFields("update", "loose", ["role", ...RISKY]),
			).toEqual(["role"]);
		});

		it("still writes the ordinary field the same rule opened", () => {
			expect(
				ability.validatePayload("update", "loose", row, { role: "editor" }).ok,
			).toBe(true);
		});
	});

	describe("what comes back cannot pollute anything either", () => {
		it("hands back an ordinary object, carrying none of the three", () => {
			const result = buildAbility(ac, [
				allow("update", "user"),
			]).validatePayload("update", "user", row, { role: "admin" });

			expect(result.ok).toBe(true);

			if (!result.ok) {
				return;
			}

			expect({ ...result.data }).toEqual({ role: "admin" });
			expect(JSON.stringify(result.data)).toBe('{"role":"admin"}');

			for (const key of RISKY) {
				expect(Object.hasOwn(result.data, key)).toBe(false);
			}
		});

		it("carries the values it validated, and only those", () => {
			const ability = buildAbility(ac, [
				allow("update", "user", { payload: { fields: ["role"] } }),
			]);

			const result = ability.validatePayload("update", "user", row, {
				role: "editor",
			});

			expect(result.ok && result.data.role).toBe("editor");
			expect(result.ok && Object.keys(result.data)).toEqual(["role"]);
		});
	});

	describe("an ordinary payload is untouched", () => {
		it("passes a plain write", () => {
			const ability = buildAbility(ac, [
				allow("update", "user", { payload: { fields: ["role"] } }),
			]);

			expect(
				ability.validatePayload("update", "user", row, { role: "editor" }).ok,
			).toBe(true);
			expect(
				ability.validatePayload("update", "user", row, {
					id: "u2",
				} as Partial<User>).ok,
			).toBe(false);
		});

		it("still refuses by value where a constraint says so", () => {
			const ability = buildAbility(ac, [
				allow("update", "user", {
					payload: { fields: ["role"], constraints: { role: "editor" } },
				}),
			]);

			expect(
				ability.validatePayload("update", "user", row, { role: "editor" }).ok,
			).toBe(true);
			expect(
				ability.validatePayload("update", "user", row, { role: "admin" }).ok,
			).toBe(false);
		});
	});
});
