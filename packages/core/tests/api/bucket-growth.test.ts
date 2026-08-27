import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";

type Post = { id: string; authorId: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
		comment: { schema: shape<{ id: string }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const post: Post = { id: "p1", authorId: "u1" };

const collect: () => void =
	(globalThis as { gc?: () => void }).gc ??
	(() => {
		v8.setFlagsFromString("--expose-gc");
		const exposed = vm.runInNewContext("gc") as () => void;
		v8.setFlagsFromString("--no-expose-gc");

		return exposed;
	})();

const settled = (): number => {
	collect();
	collect();

	return process.memoryUsage().heapUsed;
};

const retained = (run: (mark: string) => void): number => {
	run("warm");

	const before = settled();

	run("measured");

	return (settled() - before) / 1024 / 1024;
};

describe("what an ability remembers is bounded by what was declared", () => {
	describe("a name nobody declared is answered, not remembered", () => {
		it("keeps the heap flat under a stream of unseen actions", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			const grew = retained((mark) => {
				for (let index = 0; index < 100_000; index++) {
					ability.can(`${mark}-act${index}` as "read", "post", post);
				}
			});

			expect(grew).toBeLessThan(1);
		});

		it("keeps the heap flat under a stream of unseen resources", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			const grew = retained((mark) => {
				for (let index = 0; index < 100_000; index++) {
					ability.can("read", `${mark}-res${index}` as "post", post);
				}
			});

			expect(grew).toBeLessThan(1);
		});

		it("answers no for them, as it always did", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			expect(ability.can("archive" as "read", "post", post)).toBe(false);
			expect(ability.can("read", "ghost" as "post", post)).toBe(false);
			expect(ability.can("archive" as "read", "post")).toBe(false);
		});
	});

	describe("a rule the registry never heard of is still evaluated", () => {
		const dirty = [
			{ effect: "allow", action: "archive", resource: "post" },
			{ effect: "allow", action: "read", resource: "ghost" },
			{
				effect: "deny",
				action: "archive",
				resource: "post",
				where: { field: "authorId", op: "eq", value: "u2" },
			},
		] as CheckedRules;

		it("grants what it says, however often it is asked", () => {
			const ability = buildAbility(ac, dirty);

			for (let attempt = 0; attempt < 3; attempt++) {
				expect(ability.can("archive" as "read", "post", post)).toBe(true);
				expect(ability.can("read", "ghost" as "post", post)).toBe(true);
			}
		});

		it("still lets its deny override", () => {
			const ability = buildAbility(ac, dirty);

			expect(
				ability.can("archive" as "read", "post", { ...post, authorId: "u2" }),
			).toBe(false);
		});

		it("answers the same through every method", () => {
			const ability = buildAbility(ac, dirty);

			expect(ability.canMutate("archive" as "read", "post", post)).toBe(true);
			expect(ability.where("archive" as "read", "post")).toEqual({
				not: { field: "authorId", op: "eq", value: "u2" },
			});
			expect(
				ability.permittedFields("archive" as "read", "post", ["authorId"]),
			).toEqual(["authorId"]);
		});
	});

	describe("the pairs that were declared answer from memory as before", () => {
		it("repeats a verdict for a pair with rules", () => {
			const ability = buildAbility(ac, [
				allow("read", "post", { where: { authorId: "u1" } }),
				deny("read", "post", { where: { authorId: "u2" } }),
			]);

			for (let attempt = 0; attempt < 3; attempt++) {
				expect(ability.can("read", "post", post)).toBe(true);
				expect(ability.can("read", "post", { ...post, authorId: "u2" })).toBe(
					false,
				);
			}
		});

		it("repeats a verdict for a declared pair that has no rules at all", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			for (let attempt = 0; attempt < 3; attempt++) {
				expect(ability.can("update", "post", post)).toBe(false);
				expect(ability.can("read", "comment", { id: "c1" })).toBe(false);
			}
		});

		it("serves every action of a manage rule", () => {
			const ability = buildAbility(ac, [allow("manage", "post")]);

			expect(ability.can("read", "post", post)).toBe(true);
			expect(ability.can("update", "post", post)).toBe(true);
			expect(ability.can("manage" as "read", "post", post)).toBe(true);
			expect(ability.can("read", "comment", { id: "c1" })).toBe(false);
		});

		it("keeps a manage rule answering for names nobody declared", () => {
			const ability = buildAbility(ac, [allow("manage", "post")]);

			for (let attempt = 0; attempt < 3; attempt++) {
				expect(ability.can("archive" as "read", "post", post)).toBe(true);
			}
		});
	});
});
