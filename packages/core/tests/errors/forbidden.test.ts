import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../src/errors/index.js";

describe("ForbiddenError", () => {
	it("carries action and resource and extends Error", () => {
		const error = new ForbiddenError("update", "post");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.name).toBe("ForbiddenError");
		expect(error.action).toBe("update");
		expect(error.resource).toBe("post");
		expect(error.message).toContain("update");
		expect(error.message).toContain("post");
	});

	it("leaves violations undefined when none are given", () => {
		const error = new ForbiddenError("read", "post");
		expect(error.violations).toBeUndefined();
	});

	it("carries violations when provided", () => {
		const violations = [{ field: "status", reason: "field not permitted" }];
		const error = new ForbiddenError("update", "post", violations);
		expect(error.violations).toEqual(violations);
	});
});

describe("ForbiddenError.is", () => {
	it("recognises its own instances", () => {
		expect(ForbiddenError.is(new ForbiddenError("update", "post"))).toBe(true);
	});

	it("recognises a refusal thrown by a second copy of the package", () => {
		const foreign = Object.assign(new Error("Forbidden"), {
			[Symbol.for("veto.ForbiddenError")]: true,
		});

		expect(foreign instanceof ForbiddenError).toBe(false);
		expect(ForbiddenError.is(foreign)).toBe(true);
	});

	it("rejects anything that is not a veto refusal", () => {
		for (const value of [
			new Error("nope"),
			null,
			undefined,
			"Forbidden",
			403,
			{},
		]) {
			expect(ForbiddenError.is(value)).toBe(false);
		}
	});
});
