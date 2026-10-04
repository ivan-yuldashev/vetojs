import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { CheckedRules } from "../../src/model/index.js";

type Post = { id: string; status: string; views: number };

const ac = defineAbilities({
	resources: { post: { schema: shape<Post>(), actions: ["update"] } },
});

const { deny } = createRules(ac);

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

const vetoed = (values: unknown): CheckedRules =>
	[
		{ effect: "allow", action: "update", resource: "post" },
		{
			effect: "deny",
			action: "update",
			resource: "post",
			values,
		},
	] as CheckedRules;

const unreadableConstraints = () => {
	// @ts-expect-error an or is not a constraint shorthand
	deny("update", "post", { values: UNREADABLE[0] });
	// @ts-expect-error nor is a not
	deny("update", "post", { values: UNREADABLE[1] });
	// @ts-expect-error nor a compiled relation node
	deny("update", "post", { values: UNREADABLE[2] });
	// @ts-expect-error nor a string
	deny("update", "post", { values: UNREADABLE[3] });
	// @ts-expect-error nor a number
	deny("update", "post", { values: UNREADABLE[4] });
	// @ts-expect-error nor null
	deny("update", "post", { values: UNREADABLE[5] });
	// @ts-expect-error nor an array
	deny("update", "post", { values: UNREADABLE[6] });
};

describe("a payload that says nothing never silences a rule", () => {
	describe("the shorthand refuses what it cannot read", () => {
		it("names what payload constraints take", () => {
			expect(unreadableConstraints).toBeTypeOf("function");
		});

		it("takes a field condition and an and, as it always did", () => {
			expect(
				deny("update", "post", { values: { status: "secret" } }).values,
			).toEqual({ field: "status", op: "eq", value: "secret" });

			expect(
				deny("update", "post", { values: { and: [{ status: "secret" }] } })
					.values,
			).toEqual({ and: [{ field: "status", op: "eq", value: "secret" }] });
		});

		it("does not compile an empty shorthand, which would carry no constraint", () => {
			const written = () =>
				// @ts-expect-error values describe at least one constraint
				deny("update", "post", { values: {} });

			expect(written).toBeTypeOf("function");
		});
	});

	describe("a payload key carrying undefined is the same as no payload", () => {
		it("does not turn a deny into silence", () => {
			const parsed = buildAbility(ac, vetoed(undefined));

			expect(parsed.can("update", "post", row)).toBe(false);
			expect(parsed.where("update", "post")).toEqual({ or: [] });
		});
	});
});
