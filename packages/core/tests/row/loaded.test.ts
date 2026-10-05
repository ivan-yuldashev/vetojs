import { describe, expect, it } from "vitest";
import { markLoaded } from "../../src/row/index.js";

describe("markLoaded", () => {
	it("returns a copy with the relation set", () => {
		const obj: Record<string, unknown> = {};
		const result = markLoaded(obj, "blog", null);
		expect(result).not.toBe(obj);
		expect(result.blog).toBe(null);
	});

	it("leaves the original object untouched", () => {
		const obj: Record<string, unknown> = {};
		markLoaded(obj, "blog", null);
		expect("blog" in obj).toBe(false);
	});

	it("adds the relation and nothing else", () => {
		const result = markLoaded({ id: "p" }, "blog", null);
		expect(Reflect.ownKeys(result)).toEqual(["id", "blog"]);
	});

	it("rejects an undefined value (use null for a loaded-empty relation)", () => {
		const obj: Record<string, unknown> = {};
		expect(() => markLoaded(obj, "blog", undefined)).toThrow(/null/);
		expect(() => markLoaded(obj, "blog", null)).not.toThrow();
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
	});
});

describe("markLoaded with the relations a row was loaded with", () => {
	type User = { id: string; role?: string };
	type Comment = { id: string; author?: User | null };
	type Post = {
		id: string;
		author?: User | null;
		createdAt?: Date | null;
		comments?: (Comment | string)[] | null;
	};

	it("fills a missing to-one with null and a missing list with an empty list", () => {
		const result = markLoaded({ id: "p" } as Post, {
			author: null,
			comments: [],
		});

		expect(result).toEqual({ id: "p", author: null, comments: [] });
	});

	it("leaves the values that are there as they are", () => {
		const author = { id: "u" };
		const result = markLoaded({ id: "p", author, comments: null } as Post, {
			author: null,
			comments: [],
		});

		expect(result.author).toBe(author);
		expect(result.comments).toBe(null);
	});

	it("goes into a to-one row and into every row of a list, copying only that path", () => {
		const author = { id: "u" };
		const comment = { id: "c" };
		const row: Post = { id: "p", author, comments: [comment] };
		const result = markLoaded(row, {
			author: { comments: [] } as never,
			comments: [{ author: null }],
		});

		expect(result).toEqual({
			id: "p",
			author: { id: "u", comments: [] },
			comments: [{ id: "c", author: null }],
		});
		expect(row).toEqual({ id: "p", author, comments: [comment] });
		expect(author).toEqual({ id: "u" });
		expect(comment).toEqual({ id: "c" });
	});

	it("leaves alone what is not a row", () => {
		const createdAt = new Date(0);
		const list = [{ id: "c" }];
		const result = markLoaded(
			{
				id: "p",
				createdAt,
				author: list as never,
				comments: ["c1", { id: "c2" }],
			} as Post,
			{
				createdAt: {},
				author: { id: null } as never,
				comments: [{ author: null }],
			},
		);

		expect(result.createdAt).toBe(createdAt);
		expect(result.author).toBe(list);
		expect(result.comments).toEqual(["c1", { id: "c2", author: null }]);
	});

	it("leaves an object where a list belongs as it is", () => {
		const one = { id: "c" };
		const result = markLoaded({ id: "p", comments: one as never } as Post, {
			comments: [{ author: null }],
		});

		expect(result.comments).toBe(one);
	});

	it("does not mark a relation named with undefined", () => {
		const result = markLoaded(
			{ id: "p" } as Post,
			{
				author: undefined,
			} as never,
		);

		expect(Object.hasOwn(result, "author")).toBe(false);
	});

	it("fills a relation the row only inherits, as its own key", () => {
		const row = Object.assign(Object.create({ author: { id: "u" } }), {
			id: "p",
		}) as Post;
		const result = markLoaded(row, { author: null });

		expect(Object.hasOwn(result, "author")).toBe(true);
		expect(result.author).toBe(null);
	});

	it("writes a relation named __proto__ as an own key, not as a prototype", () => {
		const result = markLoaded({ id: "p" } as Record<string, unknown>, {
			["__proto__"]: null,
		});

		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(Object.hasOwn(result, "__proto__")).toBe(true);
	});
});
