import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ActionFor,
	defineAbilities,
	type ResourceName,
	type ShapeOf,
	shape,
} from "../../src/create/index.js";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: number; title: string }>(),
			actions: ["read", "delete"],
			relations: { author: { resource: "post", kind: "one" } },
		},
		comment: {
			schema: shape<{ id: number; body: string }>(),
			actions: ["read"],
		},
	},
});

type AC = typeof ac;

describe("defineAbilities — base cases", () => {
	it("returns the resource registry at runtime", () => {
		expect(Object.keys(ac)).toEqual(["post", "comment"]);
	});

	it("infers resource names", () => {
		expectTypeOf<ResourceName<AC>>().toEqualTypeOf<"post" | "comment">();
	});

	it("infers per-resource actions as literals plus manage", () => {
		expectTypeOf<ActionFor<AC, "post">>().toEqualTypeOf<
			"read" | "delete" | "manage"
		>();
		expectTypeOf<ActionFor<AC, "comment">>().toEqualTypeOf<"read" | "manage">();
	});

	it("infers per-resource shape from the schema", () => {
		expectTypeOf<ShapeOf<AC, "post">>().toEqualTypeOf<{
			id: number;
			title: string;
		}>();
		expectTypeOf<ShapeOf<AC, "comment">>().toEqualTypeOf<{
			id: number;
			body: string;
		}>();
	});
});

describe("defineAbilities — edge cases & type constraints", () => {
	it("handles empty registry safely", () => {
		const emptyAc = defineAbilities({ resources: {} });
		expect(Object.keys(emptyAc)).toEqual([]);
		expectTypeOf<ResourceName<typeof emptyAc>>().toEqualTypeOf<never>();
	});

	it("infers only 'manage' when actions array is empty", () => {
		const noActionsAc = defineAbilities({
			resources: {
				system: { schema: shape<{ id: string }>(), actions: [] },
			},
		});
		expectTypeOf<
			ActionFor<typeof noActionsAc, "system">
		>().toEqualTypeOf<"manage">();
	});

	it("enforces valid resource names in relations at compile time", () => {
		const invalidAc = defineAbilities({
			resources: {
				post: {
					schema: shape<{ id: string }>(),
					actions: ["read"],
					// @ts-expect-error 'users' does not exist; the types must catch it
					relations: { author: { resource: "users", kind: "one" } },
				},
			},
		});

		expect(invalidAc).toBeDefined();
	});
});
