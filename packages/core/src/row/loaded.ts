import type { Row } from "../model/index.js";
import { owns } from "../shared/index.js";

const LOADED_MARKER = Symbol.for("veto:loaded");

const loadedRelationNames = (row: Row): Set<string> | undefined => {
	if (!owns(row, LOADED_MARKER)) {
		return undefined;
	}

	const marker: unknown = Reflect.get(row, LOADED_MARKER);

	return marker instanceof Set ? marker : undefined;
};

/**
 * States that a relation is loaded, for data your ORM didn't assemble.
 *
 * The engine normally reads the convention Prisma, Drizzle and TypeORM already follow —
 * `undefined` means not loaded (and a check needing it throws), `null` means loaded and
 * empty. Reach for this only when that convention doesn't apply.
 *
 * Returns a **copy**; your input is not mutated. The marker is a global symbol, so
 * `Object.keys` and `JSON.stringify` don't see it.
 *
 * @param value - the related row(s), or `null` for loaded-but-empty
 * @throws {Error} if `value` is `undefined` — that is precisely what "not loaded" means,
 *   so marking a relation loaded with it is a contradiction
 *
 * @example
 * const withAuthor = markLoaded(post, "author", author);
 * const withoutBlog = markLoaded(post, "blog", null);
 */
export const markLoaded = <T extends Row>(
	row: T,
	relation: string,
	value: unknown,
): T => {
	if (value === undefined) {
		throw new Error(
			`veto: markLoaded("${relation}", undefined) is ambiguous — undefined means "not loaded". Pass null for a loaded-but-empty relation.`,
		);
	}

	const loaded = new Set(loadedRelationNames(row));

	loaded.add(relation);

	return { ...row, [relation]: value, [LOADED_MARKER]: loaded };
};

export const isLoaded = (row: Row, relation: string): boolean => {
	return loadedRelationNames(row)?.has(relation) ?? false;
};
