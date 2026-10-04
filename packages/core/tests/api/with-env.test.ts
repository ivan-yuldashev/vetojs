import { describe, expect, it } from "vitest";
import { buildAbility, withEnv } from "../../src/api/index.js";
import type { CheckedRules } from "../../src/model/index.js";

const IN_EU = { field: "region", op: "eq", value: "eu" };

const unbound = (
	rules: unknown[],
	options?: Parameters<typeof buildAbility>[2],
) => buildAbility({}, rules as CheckedRules, options) as never;

describe("withEnv", () => {
	it("lets an allow whose when holds take part", () => {
		const ability = withEnv(
			unbound([
				{ effect: "allow", action: "read", resource: "post", when: IN_EU },
			]),
			{ region: "eu" } as never,
		);

		expect(ability.can("read", "post", { id: "p1" } as never)).toBe(true);
	});

	it("reads what is not a plain object as an environment without keys", () => {
		for (const env of [null, "eu", ["eu"], new Date()]) {
			const ability = withEnv(
				unbound([
					{ effect: "allow", action: "read", resource: "post" },
					{ effect: "deny", action: "read", resource: "post", when: IN_EU },
				]),
				env as never,
			);

			expect(ability.can("read", "post", { id: "p1" } as never)).toBe(false);
		}
	});

	it("hands back the same binding for an environment with the same keys and values", () => {
		const ability = unbound([
			{ effect: "allow", action: "read", resource: "post", when: IN_EU },
		]);
		const eu = withEnv(ability, { region: "eu" } as never);

		expect(withEnv(ability, { region: "eu" } as never)).toBe(eu);
		expect(withEnv(ability, { region: "us" } as never)).not.toBe(eu);
		expect(withEnv(ability, { region: "eu", extra: 1 } as never)).not.toBe(eu);
		expect(
			withEnv(ability, { region: "us" } as never).can("read", "post", {
				id: "p1",
			} as never),
		).toBe(false);
		expect(
			withEnv(ability, { region: "eu" } as never).can("read", "post", {
				id: "p1",
			} as never),
		).toBe(true);
	});

	it("binds again when the environment gains a key", () => {
		const ability = unbound([
			{
				effect: "allow",
				action: "read",
				resource: "post",
				when: { field: "mfa", op: "eq", value: true },
			},
		]);
		const row = { id: "p1" } as never;

		expect(
			withEnv(ability, { region: "eu" } as never).can("read", "post", row),
		).toBe(false);
		expect(
			withEnv(ability, { region: "eu", mfa: true } as never).can(
				"read",
				"post",
				row,
			),
		).toBe(true);
	});

	it("reports to the hook of the ability it binds", () => {
		const heard: boolean[] = [];
		const ability = withEnv(
			unbound(
				[{ effect: "allow", action: "read", resource: "post", when: IN_EU }],
				{
					onDecision: (decision) => heard.push(decision.allowed),
				},
			),
			{ region: "us" } as never,
		);

		ability.can("read", "post", { id: "p1" } as never);

		expect(heard).toEqual([false]);
	});
});
