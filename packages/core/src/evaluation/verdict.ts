import type { Verdict } from "./verdict.types.js";

export type { Verdict } from "./verdict.types.js";

export type VerdictOf<Item, Context> = (
	item: Item,
	context: Context,
) => Verdict;

export const kleeneAndOver = <Item, Context = undefined>(
	items: readonly Item[],
	verdictOf: VerdictOf<Item, Context>,
	context: Context,
	visitAll = false,
): Verdict => {
	let result: Verdict = true;

	for (const item of items) {
		const verdict = verdictOf(item, context);

		if (verdict === false) {
			if (!visitAll) {
				return false;
			}

			result = false;
			continue;
		}

		if (verdict === undefined && result === true) {
			result = undefined;
		}
	}

	return result;
};

export const kleeneOrOver = <Item, Context = undefined>(
	items: readonly Item[],
	verdictOf: VerdictOf<Item, Context>,
	context: Context,
	visitAll = false,
): Verdict => {
	let result: Verdict = false;

	for (const item of items) {
		const verdict = verdictOf(item, context);

		if (verdict === true) {
			if (!visitAll) {
				return true;
			}

			result = true;
			continue;
		}

		if (verdict === undefined && result === false) {
			result = undefined;
		}
	}

	return result;
};

export const kleeneNot = (verdict: Verdict): Verdict => {
	return verdict === undefined ? undefined : !verdict;
};
