import { type Ability, defineAbilities, shape } from "@vetojs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createVetoContext } from "../src/context.js";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; status: "draft" | "published" }>(),
			actions: ["read", "update"],
		},
	},
});

describe("createVetoContext", () => {
	it("returns AbilityProvider, useAbility and Can", () => {
		const context = createVetoContext(ac);
		expect(typeof context.AbilityProvider).toBe("function");
		expect(typeof context.useAbility).toBe("function");
		expect(typeof context.Can).toBe("function");
	});

	it("types useAbility as Ability of the given AC", () => {
		const { useAbility } = createVetoContext(ac);
		expectTypeOf(useAbility).returns.toEqualTypeOf<Ability<typeof ac>>();
	});

	it("narrows Can props per resource", () => {
		const { Can } = createVetoContext(ac);
		const assertTypes = () => {
			Can({ I: "update", a: "post" });
			// @ts-expect-error unknown action for post
			Can({ I: "delete", a: "post" });
			// @ts-expect-error unknown resource
			Can({ I: "read", a: "comment" });
		};
		expect(assertTypes).toBeTypeOf("function");
	});

	it("requires exactly one of rules / ability on the provider", () => {
		const { AbilityProvider, useAbility } = createVetoContext(ac);
		const ability = {} as ReturnType<typeof useAbility>;
		const assertTypes = () => {
			AbilityProvider({ rules: [] });
			AbilityProvider({ ability });
			// @ts-expect-error rules and ability are mutually exclusive
			AbilityProvider({ rules: [], ability });
			// @ts-expect-error either rules or ability is required
			AbilityProvider({});
		};
		expect(assertTypes).toBeTypeOf("function");
	});
});
