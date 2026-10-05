import { describe, expect, it } from "vitest";
import type { Reach } from "../../src/compile/index.js";
import { walkReaches } from "../../src/compile/index.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import { markLoaded } from "../../src/row/index.js";

const team: Reach = { relation: "team", kind: "one", through: [] };
const author: Reach = { relation: "author", kind: "one", through: [team] };
const comments: Reach = {
	relation: "comments",
	kind: "many",
	through: [author],
};

const walks = (reaches: Reach[], row: Record<string, unknown>) => () =>
	walkReaches(reaches, row);

describe("walking the relations a check reaches", () => {
	it("throws for a relation that was never loaded, naming it", () => {
		expect(walks([author], { id: "p1" })).toThrowError(
			expect.objectContaining({ relation: "author" }),
		);
		expect(walks([author], { id: "p1" })).toThrow(RelationNotLoadedError);
	});

	it("passes a relation loaded, loaded empty, or marked loaded", () => {
		expect(walks([team], { team: { id: "t1" } })).not.toThrow();
		expect(walks([team], { team: null })).not.toThrow();
		expect(walks([team], markLoaded({}, "team", null))).not.toThrow();
		expect(walks([comments], { comments: [] })).not.toThrow();
	});

	it("throws for a relation set back to undefined after it was marked loaded", () => {
		const marked = markLoaded({}, "team", null);

		expect(walks([team], { ...marked, team: undefined })).toThrow(
			RelationNotLoadedError,
		);
	});

	it("walks into a to-one relation and finds what it left unloaded", () => {
		expect(walks([author], { author: { id: "u1" } })).toThrowError(
			expect.objectContaining({ relation: "team" }),
		);
		expect(
			walks([author], { author: { id: "u1", team: { id: "t1" } } }),
		).not.toThrow();
	});

	it("walks into every row of a to-many relation", () => {
		const loaded = { author: { team: null } };

		expect(walks([comments], { comments: [loaded, loaded] })).not.toThrow();
		expect(walks([comments], { comments: [loaded, {}] })).toThrowError(
			expect.objectContaining({ relation: "author" }),
		);
		expect(
			walks([comments], { comments: [loaded, { author: {} }] }),
		).toThrowError(expect.objectContaining({ relation: "team" }));
	});

	it("throws for an id where a related row belongs", () => {
		expect(walks([team], { team: "t1" })).toThrow(RelationNotLoadedError);
		expect(walks([comments], { comments: [{ author: null }, 7] })).toThrow(
			RelationNotLoadedError,
		);
	});

	it("goes no further into a relation of the wrong shape", () => {
		expect(walks([author], { author: [{ id: "u1" }] })).not.toThrow();
		expect(walks([comments], { comments: { id: "c1" } })).not.toThrow();
		expect(walks([comments], { comments: [true] })).not.toThrow();
	});

	it("walks each relation it is given", () => {
		expect(walks([team, author], { team: null })).toThrowError(
			expect.objectContaining({ relation: "author" }),
		);
	});
});
