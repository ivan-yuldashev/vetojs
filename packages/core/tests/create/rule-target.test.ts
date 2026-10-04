import { describe, expect, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; title: string; status: string }>(),
			actions: ["update"],
		},
		user: {
			schema: shape<{ id: string; email: string }>(),
			actions: ["update"],
		},
	},
});

const { allow, deny } = createRules(ac);

const twoResources = { post: ["title"], user: ["email"] } as unknown as "post";
const noResource = {} as unknown as "post";

describe("a rule names one resource", () => {
	it("refuses a target naming two, rather than keeping the first", () => {
		expect(() => allow("update", twoResources)).toThrow(/names one resource/);
		expect(() => deny("update", twoResources)).toThrow(/names one resource/);
	});

	it("refuses a target naming none", () => {
		expect(() => allow("update", noResource)).toThrow(/names one resource/);
	});

	it("takes the resource alone, and the resource with its fields", () => {
		expect(allow("update", "post").fields).toBeUndefined();
		expect(allow("update", { post: ["title"] }).fields).toEqual(["title"]);
	});
});

describe("a target written once and reused", () => {
	const titleOnly = { post: ["title"] } as const;

	it("is taken as it is, read-only", () => {
		expect(allow("update", titleOnly).fields).toEqual(["title"]);
		expect(deny("update", titleOnly).fields).toEqual(["title"]);
	});

	it("still bounds the values of a permission to the fields it names", () => {
		// @ts-expect-error the permission covers title alone, so a value on status never fires
		allow("update", titleOnly, { values: { status: "draft" } });

		expect(
			deny("update", titleOnly, { values: { status: "draft" } }).values,
		).toEqual({ field: "status", op: "eq", value: "draft" });
	});

	it("still refuses a field the resource does not have", () => {
		const unknown = { post: ["email"] } as const;

		// @ts-expect-error post has no email
		allow("update", unknown);
	});
});
