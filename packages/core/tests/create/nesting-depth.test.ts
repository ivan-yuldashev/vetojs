import { describe, expect, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";

type Node = { id: string; name: string };

const ac = defineAbilities({
	resources: {
		node: {
			schema: shape<Node>(),
			actions: ["read"],
			relations: { parent: { resource: "node", kind: "one" } },
		},
	},
});

const { allow } = createRules(ac);

export const nesting = () => {
	allow("read", "node", {
		where: { and: [{ or: [{ not: { and: [{ or: [{ name: "x" }] }] } }] }] },
	});

	allow("read", "node", {
		where: { not: { not: { not: { not: { not: { name: "x" } } } } } },
	});

	allow("read", "node", {
		where: {
			and: [
				{ or: [{ not: { and: [{ parent: { parent: { name: "x" } } }] } }] },
			],
		},
	});

	allow("read", "node", {
		where: {
			parent: { parent: { parent: { parent: { parent: { name: "x" } } } } },
		},
	});
};

describe("nesting", () => {
	it("groups nest as deep as they are written", () => {
		expect(
			allow("read", "node", {
				where: { and: [{ or: [{ not: { and: [{ or: [{ name: "x" }] }] } }] }] },
			}).where,
		).toEqual({
			and: [
				{
					or: [
						{
							not: { and: [{ or: [{ field: "name", op: "eq", value: "x" }] }] },
						},
					],
				},
			],
		});
	});

	it("relations nest as deep as they are written", () => {
		const hop = (where: unknown) => ({
			relation: "parent",
			type: "one",
			where,
		});

		expect(
			allow("read", "node", {
				where: { parent: { parent: { name: "x" } } },
			}).where,
		).toEqual(hop(hop({ field: "name", op: "eq", value: "x" })));
		expect(
			allow("read", "node", {
				where: {
					parent: { parent: { parent: { parent: { parent: { name: "x" } } } } },
				},
			}).where,
		).toEqual(hop(hop(hop(hop(hop({ field: "name", op: "eq", value: "x" }))))));
	});
});
