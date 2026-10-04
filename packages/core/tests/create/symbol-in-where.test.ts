import { describe, expect, it } from "vitest";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";

const slot = Symbol("slot");

type Post = { title: string; status: string; [slot]: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
	},
});

const { allow, deny } = createRules(ac);

const withSymbol = (extra: Record<string, unknown> = {}) =>
	({ [slot]: "x", ...extra }) as never;

describe("a symbol cannot name a field", () => {
	it("refuses a where that names one", () => {
		expect(() => allow("read", "post", { where: withSymbol() })).toThrow(
			TypeError,
		);
	});

	it("refuses it beside a string key, rather than dropping it", () => {
		expect(() =>
			allow("read", "post", { where: withSymbol({ status: "draft" }) }),
		).toThrow(/symbol/i);
	});

	it("names the key it refused", () => {
		expect(() => allow("read", "post", { where: withSymbol() })).toThrow(
			/Symbol\(slot\)/,
		);
	});

	it("refuses it in values too", () => {
		expect(() =>
			deny("update", "post", { values: withSymbol({ status: "draft" }) }),
		).toThrow(/symbol/i);
	});

	it("leaves a condition of plain string keys alone", () => {
		expect(() =>
			allow("read", "post", { where: { status: "draft" } }),
		).not.toThrow();
	});
});
