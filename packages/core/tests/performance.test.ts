import { describe, expect, it } from "vitest";
import { buildAbility } from "../src/api/ability.js";
import { createRules } from "../src/api/create-rules.js";
import { defineAbilities } from "../src/api/define-abilities.js";
import { shape } from "../src/api/schema.js";

type Post = {
	id: string;
	authorId: string;
	status: "draft" | "published";
	views: number;
};

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update", "publish"] },
		comment: {
			schema: shape<{ id: string; spam: boolean }>(),
			actions: ["read"],
		},
	},
});

const { allow, deny } = createRules(ac);
const me = "u7";

const policy = [
	allow("read", "post", { where: { status: "published" } }),
	allow("read", "post", { where: { authorId: me } }),
	allow(["update", "publish"], "post", {
		where: { authorId: me, status: { ne: "draft" } },
	}),
	allow("read", "comment"),
	deny("read", "comment", { where: { spam: true } }),
];

const rows: Post[] = Array.from({ length: 100 }, (_, index) => ({
	id: `p${index}`,
	authorId: index % 3 === 0 ? me : `u${index}`,
	status: index % 2 === 0 ? "published" : "draft",
	views: index * 7,
}));

const microseconds = (run: () => void): number => {
	for (let index = 0; index < 20; index++) {
		run();
	}

	const started = process.hrtime.bigint();
	let iterations = 0;

	while (Number(process.hrtime.bigint() - started) < 6e7) {
		run();
		iterations++;
	}

	return Number(process.hrtime.bigint() - started) / 1000 / iterations;
};

const best = (run: () => void, attempts = 2): number => {
	let fastest = Number.POSITIVE_INFINITY;

	for (let attempt = 0; attempt < attempts; attempt++) {
		fastest = Math.min(fastest, microseconds(run));
	}

	return fastest;
};

let sink = 0;

describe("the engine stays within reach of the work it does", () => {
	it("builds an ability for far less than it costs to use one", () => {
		const ability = buildAbility(ac, policy);

		const build = best(() => {
			sink += buildAbility(ac, policy).rules.length;
		});

		const hundred = best(() => {
			for (const row of rows) {
				sink += ability.can("update", "post", row) ? 1 : 0;
			}
		});

		expect(build).toBeLessThan(hundred / 10);
	});

	it("does not pay again for a condition it has already seen", () => {
		const ability = buildAbility(ac, policy);

		const first = microseconds(() => {
			for (const row of rows) {
				sink += ability.can("update", "post", row) ? 1 : 0;
			}
		});

		const later = best(() => {
			for (const row of rows) {
				sink += ability.can("update", "post", row) ? 1 : 0;
			}
		});

		expect(later).toBeLessThan(first * 3);
	});

	it("answers about one resource without paying for the others", () => {
		const wide = buildAbility(ac, [
			...policy,
			...Array.from({ length: 200 }, (_, index) =>
				allow("read", "comment", { where: { id: `c${index}` } }),
			),
		]);

		const narrow = buildAbility(ac, policy);

		const wideCost = best(() => {
			for (const row of rows) {
				sink += wide.can("update", "post", row) ? 1 : 0;
			}
		});

		const narrowCost = best(() => {
			for (const row of rows) {
				sink += narrow.can("update", "post", row) ? 1 : 0;
			}
		});

		expect(wideCost).toBeLessThan(narrowCost * 3);
		expect(sink, "the measured loops were optimised away").toBeGreaterThan(0);
	});
});
