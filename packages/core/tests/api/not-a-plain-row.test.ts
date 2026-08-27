import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { DecisionReport } from "../../src/api/ability.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";

type Post = { id: string; authorId: string };

const ac = defineAbilities({
	resources: { post: { schema: shape<Post>(), actions: ["read", "update"] } },
});

const { allow } = createRules(ac);

class Entity {
	id = "p1";
	authorId = "u1";
}

const watched = (
	rules = [allow("read", "post", { where: { authorId: "u1" } })],
) => {
	const seen: DecisionReport[] = [];
	const ability = buildAbility(ac, rules, {
		onDecision: (decision) => seen.push(decision),
	});

	return { seen, ability };
};

const plain: Post = { id: "p1", authorId: "u1" };

const REFUSED = [
	["a class instance", new Entity()],
	["a Date", new Date()],
	["an array", [{ id: "p1", authorId: "u1" }]],
	["a Map", new Map([["authorId", "u1"]])],
	["a string", "p1"],
	["a number", 7],
	["null", null],
] as const;

describe("a row the engine will not read says so in the decision", () => {
	describe("the verdict does not move", () => {
		it("refuses each of them, as it always did", () => {
			const { ability } = watched();

			for (const [, value] of REFUSED) {
				expect(ability.can("read", "post", value as unknown as Post)).toBe(
					false,
				);
			}
		});

		it("still grants the plain row that matches", () => {
			const { ability } = watched();

			expect(ability.can("read", "post", plain)).toBe(true);
		});

		it("throws nothing, whatever it was handed", () => {
			const { ability } = watched();

			for (const [, value] of REFUSED) {
				expect(() =>
					ability.can("read", "post", value as unknown as Post),
				).not.toThrow();
			}
		});
	});

	describe("the reason reaches the hook", () => {
		it("names each refusal that never reached the rules", () => {
			for (const [what, value] of REFUSED) {
				const { seen, ability } = watched();

				ability.can("read", "post", value as unknown as Post);

				expect([what, seen[0]?.reason]).toEqual([what, "not a plain row"]);
				expect(seen[0]?.allowed).toBe(false);
				expect(seen[0]?.rule).toBeUndefined();
			}
		});

		it("says nothing of the sort for a plain row", () => {
			const { seen, ability } = watched();

			ability.can("read", "post", plain);

			expect(seen[0]?.reason).toBeUndefined();
			expect(seen[0]?.allowed).toBe(true);
		});

		it("says nothing for a row built without a prototype", () => {
			const { seen, ability } = watched();
			const bare = Object.assign(Object.create(null), plain) as Post;

			expect(ability.can("read", "post", bare)).toBe(true);
			expect(seen[0]?.reason).toBeUndefined();
		});

		it("says nothing when no row was passed at all", () => {
			const { seen, ability } = watched();

			ability.can("read", "post");

			expect(seen[0]?.reason).toBeUndefined();
		});

		it("reports it through cannot and authorize too", () => {
			const { seen, ability } = watched();

			ability.cannot("read", "post", new Entity() as unknown as Post);
			expect(() =>
				ability.authorize("read", "post", new Entity() as unknown as Post),
			).toThrow();

			expect(seen.map((decision) => decision.reason)).toEqual([
				"not a plain row",
				"not a plain row",
			]);
		});

		it("reports it on a mutation check as well", () => {
			const { seen, ability } = watched([allow("update", "post")]);

			expect(
				ability.canMutate("update", "post", new Entity() as unknown as Post),
			).toBe(false);
			expect(seen[0]?.reason).toBe("not a plain row");
		});

		it("leaves the guard's own reason alone", () => {
			const { seen, ability } = watched();

			ability.can("read", "post", plain);

			expect(seen[0]).toEqual({
				action: "read",
				resource: "post",
				allowed: true,
				rule: expect.objectContaining({ effect: "allow" }),
			});
		});
	});

	describe("without a hook nothing changes", () => {
		it("answers exactly the same", () => {
			const quiet = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
			]);

			expect(quiet.can("read", "post", new Entity() as unknown as Post)).toBe(
				false,
			);
			expect(quiet.can("read", "post", plain)).toBe(true);
		});
	});
});
