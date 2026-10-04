import { describe, expect, it } from "vitest";
import { RelationNotLoadedError } from "../../src/errors/index.js";

describe("RelationNotLoadedError", () => {
	it("is an Error that carries the relation name", () => {
		const error = new RelationNotLoadedError("blog");
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("RelationNotLoadedError");
		expect(error.relation).toBe("blog");
		expect(error.message).toContain("blog");
	});
});
