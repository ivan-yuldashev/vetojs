import { describe, expect, it } from "vitest";
import { isLoaded, markLoaded } from "../../src/row/index.js";

describe("markLoaded / isLoaded", () => {
	it("returns a copy with the value set and the relation marked", () => {
		const obj: Record<string, unknown> = {};
		const result = markLoaded(obj, "blog", null);
		expect(result).not.toBe(obj);
		expect(result.blog).toBe(null);
		expect(isLoaded(result, "blog")).toBe(true);
	});

	it("leaves the original object untouched", () => {
		const obj: Record<string, unknown> = {};
		markLoaded(obj, "blog", null);
		expect(isLoaded(obj, "blog")).toBe(false);
		expect("blog" in obj).toBe(false);
	});

	it("reports unmarked relations as not loaded", () => {
		const obj: Record<string, unknown> = { blog: null };
		expect(isLoaded(obj, "blog")).toBe(false);
	});

	it("accumulates multiple loaded relations across the chain", () => {
		const obj: Record<string, unknown> = {};
		const result = markLoaded(markLoaded(obj, "blog", null), "author", {
			id: "u1",
		});
		expect(isLoaded(result, "blog")).toBe(true);
		expect(isLoaded(result, "author")).toBe(true);
		expect(isLoaded(result, "comments")).toBe(false);
	});

	it("rejects an undefined value (use null for a loaded-empty relation)", () => {
		const obj: Record<string, unknown> = {};
		expect(() => markLoaded(obj, "blog", undefined)).toThrow(/null/);
		expect(() => markLoaded(obj, "blog", null)).not.toThrow();
	});

	it("does not expose the marker as an enumerable string key", () => {
		const obj: Record<string, unknown> = {};
		const result = markLoaded(obj, "blog", null);
		expect(Object.keys(result)).toEqual(["blog"]);
	});

	it("ignores a corrupted marker value", () => {
		const obj: Record<string, unknown> = {};
		Reflect.set(obj, Symbol.for("veto:loaded"), "garbage");
		expect(isLoaded(obj, "blog")).toBe(false);
	});

	it("writes a relation named __proto__ as an own key, not as a prototype", () => {
		const marked = markLoaded(
			{ id: "p" } as Record<string, unknown>,
			"__proto__",
			{
				evil: true,
			},
		);

		expect(({} as Record<string, unknown>).evil).toBeUndefined();
		expect(Object.getPrototypeOf(marked)).toBe(Object.prototype);
		expect(Object.hasOwn(marked, "__proto__")).toBe(true);
		expect(marked.evil).toBeUndefined();
		expect(isLoaded(marked, "__proto__")).toBe(true);
	});
});
