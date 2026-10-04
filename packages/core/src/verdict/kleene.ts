import { only } from "../shared/index.js";
import type { Verdict } from "./verdict.types.js";

type VerdictOf<Item, Context> = (item: Item, context: Context) => Verdict;

const fold = <Item, Context>(
	absorbing: boolean,
	items: readonly Item[],
	verdictOf: VerdictOf<Item, Context>,
	context: Context,
): Verdict => {
	let result: Verdict = !absorbing;

	for (const item of items) {
		const verdict = verdictOf(item, context);

		if (verdict === absorbing) {
			return absorbing;
		}

		if (verdict === undefined) {
			result = undefined;
		}
	}

	return result;
};

export const kleeneAndOver = <Item, Context = undefined>(
	items: readonly Item[],
	verdictOf: VerdictOf<Item, Context>,
	context: Context,
): Verdict => {
	return fold(false, items, verdictOf, context);
};

export const kleeneOrOver = <Item, Context = undefined>(
	items: readonly Item[],
	verdictOf: VerdictOf<Item, Context>,
	context: Context,
): Verdict => {
	return fold(true, items, verdictOf, context);
};

type Test<Context> = (context: Context) => Verdict;

const combine = (absorbing: boolean) => {
	return <Context>(tests: readonly Test<Context>[]): Test<Context> => {
		const settle = (context: Context): Verdict => {
			let result: Verdict = !absorbing;

			for (const test of tests) {
				const verdict = test(context);

				if (verdict === absorbing) {
					return absorbing;
				}

				if (verdict === undefined) {
					result = undefined;
				}
			}

			return result;
		};

		return only(tests) ?? settle;
	};
};

export const allOf = combine(false);

export const anyOf = combine(true);

export const kleeneNot = (verdict: Verdict): Verdict => {
	return verdict === undefined ? undefined : !verdict;
};
