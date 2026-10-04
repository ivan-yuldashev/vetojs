import { describe, expect, expectTypeOf, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { EnvDeclared, EnvOf } from "../../src/index.js";
import type { CheckedRule, CheckedRules } from "../../src/model/index.js";

type Post = { id: string; authorId: string };

describe("the names the package exports", () => {
	it("names one checked rule the way it names many", () => {
		const ac = defineAbilities({
			resources: { post: { schema: shape<Post>(), actions: ["read"] } },
		});
		const { allow } = createRules(ac);
		const one: CheckedRule = allow("read", "post");

		expectTypeOf<CheckedRules>().toEqualTypeOf<CheckedRule[]>();
		expect(one.resource).toBe("post");
	});

	it("names the environment a declaration carries, so the declaration can be exported", () => {
		const ac = defineAbilities({
			env: shape<{ hour: number }>(),
			resources: { post: { schema: shape<Post>(), actions: ["read"] } },
		});

		expectTypeOf(ac).toExtend<EnvDeclared>();
		expectTypeOf<EnvOf<typeof ac>>().toEqualTypeOf<{ hour: number }>();
		expect(Object.keys(ac)).toEqual(["post"]);
	});

	it("keeps the row shape when the schema was declared as a shape", () => {
		const ac = defineAbilities({
			resources: { post: { schema: shape<Post>(), actions: ["read"] } },
		});
		const ability = buildAbility(ac, []);

		expect(ability.can("read", "post", { id: "p1", authorId: "u1" })).toBe(
			false,
		);

		// @ts-expect-error the row must still match the declared shape
		ability.can("read", "post", { nope: true });
	});
});
