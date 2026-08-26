import { describe, expect, it } from "vitest";
import { evaluateOperator } from "../../src/evaluation/operator.js";

describe("evaluateOperator", () => {
	describe("eq", () => {
		it("returns true for strictly equal primitives", () => {
			expect(evaluateOperator("eq", "published", "published")).toBe(true);
			expect(evaluateOperator("eq", 42, 42)).toBe(true);
		});
		it("returns false for different values", () => {
			expect(evaluateOperator("eq", "draft", "published")).toBe(false);
		});
		it("is case sensitive", () => {
			expect(evaluateOperator("eq", "Published", "published")).toBe(false);
		});
		it("treats null and undefined as distinct", () => {
			expect(evaluateOperator("eq", null, undefined)).toBe(false);
		});
		it("returns false for NaN compared to NaN (JS semantics)", () => {
			expect(evaluateOperator("eq", Number.NaN, Number.NaN)).toBe(false);
		});
	});

	describe("ne", () => {
		it("inverts eq", () => {
			expect(evaluateOperator("ne", "draft", "published")).toBe(true);
			expect(evaluateOperator("ne", "draft", "draft")).toBe(false);
		});
		it("returns true for NaN compared to NaN", () => {
			expect(evaluateOperator("ne", Number.NaN, Number.NaN)).toBe(true);
		});
	});

	describe("in", () => {
		it("returns true when the value is a member", () => {
			expect(evaluateOperator("in", "draft", ["draft", "published"])).toBe(
				true,
			);
		});
		it("returns false when the value is not a member", () => {
			expect(evaluateOperator("in", "archived", ["draft", "published"])).toBe(
				false,
			);
		});
		it("returns undefined when the expected value is not an array", () => {
			expect(evaluateOperator("in", "draft", "draft")).toBeUndefined();
		});
		it("returns false for an empty array (Vacuous falsity)", () => {
			expect(evaluateOperator("in", "draft", [])).toBe(false);
		});
		it("returns undefined when no member matches but one is incomparable", () => {
			expect(
				evaluateOperator("in", "draft", [{}, "published"]),
			).toBeUndefined();
		});
		it("returns true when a later member matches despite an incomparable one", () => {
			expect(evaluateOperator("in", "draft", [{}, "draft"])).toBe(true);
		});
	});

	describe("nin", () => {
		it("is the strict negation of in", () => {
			expect(evaluateOperator("nin", "archived", ["draft", "published"])).toBe(
				true,
			);
			expect(evaluateOperator("nin", "draft", ["draft", "published"])).toBe(
				false,
			);
		});
		it("returns undefined when the expected value is not an array", () => {
			expect(evaluateOperator("nin", "draft", "draft")).toBeUndefined();
		});
		it("stays undefined when a member is incomparable", () => {
			expect(
				evaluateOperator("nin", "draft", [{}, "published"]),
			).toBeUndefined();
		});
		it("returns true for an empty array", () => {
			expect(evaluateOperator("nin", "draft", [])).toBe(true);
		});
	});

	describe("numeric comparison", () => {
		it("gt", () => {
			expect(evaluateOperator("gt", 5, 3)).toBe(true);
			expect(evaluateOperator("gt", 3, 5)).toBe(false);
			expect(evaluateOperator("gt", 5, 5)).toBe(false);
		});
		it("gte", () => {
			expect(evaluateOperator("gte", 5, 5)).toBe(true);
			expect(evaluateOperator("gte", 4, 5)).toBe(false);
		});
		it("lt", () => {
			expect(evaluateOperator("lt", 3, 5)).toBe(true);
			expect(evaluateOperator("lt", 5, 3)).toBe(false);
		});
		it("lte", () => {
			expect(evaluateOperator("lte", 5, 5)).toBe(true);
			expect(evaluateOperator("lte", 6, 5)).toBe(false);
		});
	});

	describe("date comparison", () => {
		it("compares by chronological order", () => {
			const earlier = new Date("2026-01-01");
			const later = new Date("2026-06-01");
			expect(evaluateOperator("gt", later, earlier)).toBe(true);
			expect(evaluateOperator("lt", earlier, later)).toBe(true);
			expect(evaluateOperator("gte", earlier, new Date("2026-01-01"))).toBe(
				true,
			);
		});
		it("orders a Date against an epoch-ms number", () => {
			const june = new Date("2026-06-01");
			const januaryMilliseconds = new Date("2026-01-01").getTime();
			expect(evaluateOperator("gt", june, januaryMilliseconds)).toBe(true);
			expect(evaluateOperator("lt", june, januaryMilliseconds)).toBe(false);
			expect(evaluateOperator("lt", januaryMilliseconds, june)).toBe(true);
		});
	});

	describe("string comparison", () => {
		it("compares lexicographically", () => {
			expect(evaluateOperator("gt", "b", "a")).toBe(true);
			expect(evaluateOperator("lt", "a", "b")).toBe(true);
		});
	});

	describe("incomparable operands", () => {
		it("returns undefined when present operands have mismatched types", () => {
			expect(evaluateOperator("gt", 5, "a")).toBeUndefined();
		});
		it("returns false when an operand is absent", () => {
			expect(evaluateOperator("gt", undefined, 5)).toBe(false);
			expect(evaluateOperator("lt", null, 5)).toBe(false);
		});
		it("returns undefined for operands that are not orderable at all", () => {
			expect(evaluateOperator("gt", true, false)).toBeUndefined();
			expect(evaluateOperator("lte", {}, {})).toBeUndefined();
		});
	});

	describe("contains", () => {
		it("returns true for substrings", () => {
			expect(evaluateOperator("contains", "hello world", "world")).toBe(true);
		});
		it("returns false when the substring is absent", () => {
			expect(evaluateOperator("contains", "hello", "xyz")).toBe(false);
		});
		it("is case sensitive", () => {
			expect(evaluateOperator("contains", "Hello", "hello")).toBe(false);
		});
		it("returns false when the expected pattern is not a string", () => {
			expect(evaluateOperator("contains", 42, 4)).toBe(false);
		});
		it("returns undefined for a present non-string actual", () => {
			expect(
				evaluateOperator("contains", ["secret"], "secret"),
			).toBeUndefined();
			expect(
				evaluateOperator("contains", { v: "secret" }, "secret"),
			).toBeUndefined();
			expect(evaluateOperator("contains", 42, "4")).toBeUndefined();
		});
		it("returns false when the actual value is absent", () => {
			expect(evaluateOperator("contains", undefined, "x")).toBe(false);
			expect(evaluateOperator("contains", null, "x")).toBe(false);
		});
		it("returns true when expected is an empty string", () => {
			expect(evaluateOperator("contains", "hello", "")).toBe(true);
			expect(evaluateOperator("contains", "", "")).toBe(true);
		});
	});

	describe("exists", () => {
		it("returns true when a present value is expected to exist", () => {
			expect(evaluateOperator("exists", "value", true)).toBe(true);
			expect(evaluateOperator("exists", 0, true)).toBe(true);
			expect(evaluateOperator("exists", false, true)).toBe(true);
		});
		it("treats null and undefined as absent", () => {
			expect(evaluateOperator("exists", null, true)).toBe(false);
			expect(evaluateOperator("exists", undefined, true)).toBe(false);
		});
		it("matches when absence is expected", () => {
			expect(evaluateOperator("exists", undefined, false)).toBe(true);
			expect(evaluateOperator("exists", "value", false)).toBe(false);
		});
		it("coerces truthy/falsy expected values to boolean", () => {
			expect(evaluateOperator("exists", "value", "yes")).toBe(true);
			expect(evaluateOperator("exists", "value", 0)).toBe(false);
			expect(evaluateOperator("exists", undefined, 0)).toBe(true);
		});
	});

	describe("unknown operator", () => {
		it("is unknown, so an allow grants nothing and a deny still fires", () => {
			expect(evaluateOperator("bogus" as never, 1, 1)).toBeUndefined();
		});
	});

	describe("date equality (value-based)", () => {
		it("eq matches two Date instances with the same time", () => {
			expect(
				evaluateOperator("eq", new Date("2026-01-01"), new Date("2026-01-01")),
			).toBe(true);
			expect(
				evaluateOperator("eq", new Date("2026-01-01"), new Date("2026-06-01")),
			).toBe(false);
		});
		it("ne inverts date equality", () => {
			expect(
				evaluateOperator("ne", new Date("2026-01-01"), new Date("2026-01-01")),
			).toBe(false);
		});
		it("in matches a Date by value", () => {
			expect(
				evaluateOperator("in", new Date("2026-01-01"), [
					new Date("2026-01-01"),
					new Date("2026-06-01"),
				]),
			).toBe(true);
			expect(
				evaluateOperator("in", new Date("2026-03-01"), [
					new Date("2026-01-01"),
				]),
			).toBe(false);
		});
		it("eq matches a Date against its epoch-ms number", () => {
			const date = new Date("2026-01-01");
			expect(evaluateOperator("eq", date, date.getTime())).toBe(true);
			expect(evaluateOperator("eq", date.getTime(), date)).toBe(true);
			expect(evaluateOperator("eq", date, date.getTime() + 1)).toBe(false);
		});
		it("in matches a Date against epoch-ms members", () => {
			const date = new Date("2026-01-01");
			expect(evaluateOperator("in", date, [date.getTime()])).toBe(true);
			expect(evaluateOperator("nin", date, [date.getTime()])).toBe(false);
		});
	});

	describe("non-scalar operands are undecidable, not unequal", () => {
		it("answers unknown for two objects", () => {
			expect(evaluateOperator("eq", { a: 1 }, { a: 1 })).toBe(undefined);
			expect(evaluateOperator("eq", { a: 1 }, { a: 2 })).toBe(undefined);
		});

		it("answers unknown for two arrays", () => {
			expect(evaluateOperator("eq", [1, 2], [1, 2])).toBe(undefined);
			expect(evaluateOperator("eq", [1, 2], [3])).toBe(undefined);
		});

		it("answers unknown even for the very same reference", () => {
			const obj = { a: 1 };
			expect(evaluateOperator("eq", obj, obj)).toBe(undefined);
		});

		it("keeps ne undecidable too, so neither polarity can decide", () => {
			expect(evaluateOperator("ne", { a: 1 }, { a: 1 })).toBe(undefined);
		});

		it("answers unknown when only one side is non-scalar", () => {
			expect(evaluateOperator("eq", { a: 1 }, "a")).toBe(undefined);
			expect(evaluateOperator("eq", "a", { a: 1 })).toBe(undefined);
		});

		it("still decides when a non-scalar meets an absent value", () => {
			expect(evaluateOperator("eq", null, { a: 1 })).toBe(false);
			expect(evaluateOperator("eq", undefined, { a: 1 })).toBe(false);
		});

		it("leaves Date on the scalar side of the line", () => {
			const when = new Date("2026-01-01");
			expect(evaluateOperator("eq", when, new Date("2026-01-01"))).toBe(true);
		});
	});

	describe("bigint", () => {
		it("orders bigints by magnitude", () => {
			expect(evaluateOperator("gt", 5n, 3n)).toBe(true);
			expect(evaluateOperator("lt", 3n, 5n)).toBe(true);
			expect(evaluateOperator("gte", 5n, 5n)).toBe(true);
		});
		it("treats equal number and bigint as equal", () => {
			expect(evaluateOperator("eq", 1, 1n)).toBe(true);
			expect(evaluateOperator("eq", 1n, 1)).toBe(true);
			expect(evaluateOperator("gte", 2, 1n)).toBe(true);
		});
		it("does not equate a fractional number with a bigint", () => {
			expect(evaluateOperator("eq", 1.5, 1n)).toBe(false);
		});
		it("equates exactly-representable integers at and beyond 2^53", () => {
			expect(evaluateOperator("eq", 9007199254740992n, 9007199254740992)).toBe(
				true,
			);
			expect(evaluateOperator("eq", 9007199254740992, 9007199254740992n)).toBe(
				true,
			);
			// biome-ignore lint/correctness/noPrecisionLoss: the precision loss is exactly what this test asserts.
			expect(evaluateOperator("eq", 9007199254740993n, 9007199254740993)).toBe(
				false,
			);
		});
	});

	describe("NaN and invalid dates (incomparable)", () => {
		it("answers unknown for NaN on either side of an ordering", () => {
			for (const op of ["gt", "gte", "lt", "lte"] as const) {
				expect(evaluateOperator(op, Number.NaN, 5)).toBeUndefined();
				expect(evaluateOperator(op, 5, Number.NaN)).toBeUndefined();
				expect(evaluateOperator(op, Number.NaN, Number.NaN)).toBeUndefined();
			}
		});

		it("answers unknown for an invalid date", () => {
			expect(
				evaluateOperator("gte", new Date("not-a-date"), new Date("2026-01-01")),
			).toBeUndefined();
			expect(
				evaluateOperator("gte", new Date("2026-01-01"), new Date("not-a-date")),
			).toBeUndefined();
			expect(
				evaluateOperator("gte", new Date("not-a-date"), 0),
			).toBeUndefined();
		});

		it("still equals decidably, where nothing is being ordered", () => {
			expect(evaluateOperator("eq", new Date("not-a-date"), Number.NaN)).toBe(
				false,
			);
			expect(evaluateOperator("eq", Number.NaN, Number.NaN)).toBe(false);
			expect(evaluateOperator("exists", Number.NaN, true)).toBe(true);
		});

		it("keeps the infinities, which are numbers a comparison can settle", () => {
			expect(evaluateOperator("gt", Number.POSITIVE_INFINITY, 5)).toBe(true);
			expect(evaluateOperator("lt", Number.NEGATIVE_INFINITY, 5)).toBe(true);
			expect(evaluateOperator("gt", 5, Number.NEGATIVE_INFINITY)).toBe(true);
		});
	});
});

describe("array membership", () => {
	it("has finds an element", () => {
		expect(evaluateOperator("has", ["a", "b"], "a")).toBe(true);
		expect(evaluateOperator("has", ["a", "b"], "c")).toBe(false);
	});

	it("hasAny needs one, hasAll needs every", () => {
		expect(evaluateOperator("hasAny", ["a"], ["a", "z"])).toBe(true);
		expect(evaluateOperator("hasAll", ["a"], ["a", "z"])).toBe(false);
		expect(evaluateOperator("hasAll", ["a", "z"], ["a", "z"])).toBe(true);
	});

	it("an empty hasAll asks nothing of an array, an empty hasAny finds nothing", () => {
		expect(evaluateOperator("hasAll", [], [])).toBe(true);
		expect(evaluateOperator("hasAny", ["a"], [])).toBe(false);
	});

	it("an absent field is a decidable non-match", () => {
		expect(evaluateOperator("has", undefined, "a")).toBe(false);
		expect(evaluateOperator("has", null, "a")).toBe(false);
		expect(evaluateOperator("hasAll", null, [])).toBe(false);
	});

	it("a present non-array is unknown, so neither polarity can decide", () => {
		expect(evaluateOperator("has", "a", "a")).toBe(undefined);
		expect(evaluateOperator("hasAny", 42, ["a"])).toBe(undefined);
	});

	it("an element the engine cannot compare leaves the answer unknown", () => {
		expect(evaluateOperator("has", [{ a: 1 }], { a: 1 })).toBe(undefined);
	});

	it("a list where a scalar is expected is unknown, not a silent hasAny", () => {
		expect(evaluateOperator("has", ["a", "b"], ["a"])).toBe(undefined);
	});

	it("hasAny and hasAll need a list, like in and nin", () => {
		expect(evaluateOperator("hasAny", ["a"], "a")).toBe(undefined);
		expect(evaluateOperator("hasAll", ["a"], "a")).toBe(undefined);
	});

	it("a decidable hit wins over an incomparable neighbour", () => {
		expect(evaluateOperator("has", ["a", { x: 1 }], "a")).toBe(true);
	});
});
