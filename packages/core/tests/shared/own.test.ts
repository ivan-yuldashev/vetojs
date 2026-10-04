import { describe, expect, it } from "vitest";
import { own, owns } from "../../src/shared/index.js";

const inheriting = (): Record<string, unknown> =>
	Object.assign(Object.create({ field: "inherited" }), { value: 1 });

describe("reading a key a rule or a row carries", () => {
	it("finds a key the object holds itself", () => {
		expect(owns({ field: "x" }, "field")).toBe(true);
		expect(own({ field: "x" }, "field")).toBe("x");
		expect(owns(inheriting(), "value")).toBe(true);
		expect(own(inheriting(), "value")).toBe(1);
	});

	it("does not find a key the object only inherits", () => {
		expect(owns(inheriting(), "field")).toBe(false);
		expect(own(inheriting(), "field")).toBeUndefined();
		expect(owns({}, "toString")).toBe(false);
		expect(own({} as Record<string, unknown>, "constructor")).toBeUndefined();
	});

	it("reads an object built without a prototype", () => {
		const bare = Object.assign(Object.create(null), { field: "x" });

		expect(owns(bare, "field")).toBe(true);
		expect(own(bare, "field")).toBe("x");
	});

	it("tells a key held as undefined from one never written", () => {
		expect(owns({ field: undefined }, "field")).toBe(true);
		expect(owns({}, "field")).toBe(false);
	});
});
