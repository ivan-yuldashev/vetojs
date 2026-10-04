import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildAbility, withEnv } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import type { CheckedRules } from "../../src/model/index.js";

type Post = { id: string; authorId: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
		comment: { schema: shape<{ id: string }>(), actions: ["read"] },
	},
});

const { allow } = createRules(ac);

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

		it("keeps the heap flat under a stream of unseen actions on a resource manage covers", () => {
			const ability = buildAbility(ac, [allow("manage", "post")]);

			const grew = retained((mark) => {
				for (let index = 0; index < 100_000; index++) {
					ability.can(`${mark}-act${index}` as "read", "post");
				}
			});

			expect(grew).toBeLessThan(1);
		});

		it("keeps the heap flat when the stream asks about manage", () => {
			const ability = buildAbility(ac, [allow("read", "post")]);

			const grew = retained((mark) => {
				for (let index = 0; index < 100_000; index++) {
					ability.can(
						"manage" as "read",
						`${mark}-res${index}` as "post",
						post,
					);
				}
			});

			expect(grew).toBeLessThan(1);
		});
	});

	describe("an environment is answered, not remembered", () => {
		it("keeps the heap flat under a stream of environments that each drop a different set of rules", () => {
			const flags = 14;
			const ability = buildAbility(
				{},
				Array.from({ length: flags + 1 }, (_, index) => ({
					effect: "allow",
					action: "read",
					resource: "post",
					when: { field: `k${index}`, op: "eq", value: true },
				})) as unknown as CheckedRules,
			) as never;

			const grew = retained((mark) => {
				for (let combination = 0; combination < 2 ** flags; combination++) {
					const env: Record<string, boolean> = {
						[`k${flags}`]: mark === "measured",
					};

					for (let index = 0; index < flags; index++) {
						env[`k${index}`] = ((combination >> index) & 1) === 1;
					}

					withEnv(ability, env as never).can("read", "post", post as never);
				}
			});

			expect(grew).toBeLessThan(1);
		});
	});
});
