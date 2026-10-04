import { describe, expect, it } from "vitest";
import type { Verdict } from "../../src/verdict/index.js";
import {
	kleeneAndOver,
	kleeneNot,
	kleeneOrOver,
} from "../../src/verdict/index.js";

const itself = (verdict: Verdict): Verdict => verdict;

const and = (...verdicts: Verdict[]) =>
	kleeneAndOver(verdicts, itself, undefined);

const or = (...verdicts: Verdict[]) =>
	kleeneOrOver(verdicts, itself, undefined);

const T = true;
const F = false;
const U = undefined;

describe("and over three answers", () => {
	it.each([
		[[T, T], T],
		[[T, F], F],
		[[F, T], F],
		[[T, U], U],
		[[U, T], U],
		[[F, U], F],
		[[U, F], F],
		[[U, U], U],
		[[F, F], F],
	] as [Verdict[], Verdict][])("%j is %s", (verdicts, answer) => {
		expect(and(...verdicts)).toBe(answer);
	});

	it("is true over nothing", () => {
		expect(and()).toBe(true);
	});
});

describe("or over three answers", () => {
	it.each([
		[[F, F], F],
		[[T, F], T],
		[[F, T], T],
		[[F, U], U],
		[[U, F], U],
		[[T, U], T],
		[[U, T], T],
		[[U, U], U],
		[[T, T], T],
	] as [Verdict[], Verdict][])("%j is %s", (verdicts, answer) => {
		expect(or(...verdicts)).toBe(answer);
	});

	it("is false over nothing", () => {
		expect(or()).toBe(false);
	});
});

describe("not over three answers", () => {
	it("flips a known answer and keeps an unknown one", () => {
		expect(kleeneNot(true)).toBe(false);
		expect(kleeneNot(false)).toBe(true);
		expect(kleeneNot(undefined)).toBeUndefined();
	});
});

describe("a fold", () => {
	it("stops at the first answer that settles it", () => {
		const asked: Verdict[] = [];
		const record = (verdict: Verdict): Verdict => {
			asked.push(verdict);
			return verdict;
		};

		expect(kleeneAndOver([U, F, T], record, undefined)).toBe(false);
		expect(asked).toEqual([U, F]);

		asked.length = 0;

		expect(kleeneOrOver([U, T, F], record, undefined)).toBe(true);
		expect(asked).toEqual([U, T]);
	});

	it("hands each item the same context", () => {
		const seen: unknown[] = [];

		kleeneAndOver(
			[1, 2],
			(item, context) => {
				seen.push([item, context]);
				return true;
			},
			"row",
		);

		expect(seen).toEqual([
			[1, "row"],
			[2, "row"],
		]);
	});
});
