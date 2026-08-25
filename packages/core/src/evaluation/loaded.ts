import type { Row } from "../shared/index.js";

const LOADED = Symbol.for("veto:loaded");

const loadedRelationNames = (instance: Row): Set<string> | undefined => {
	if (!Object.hasOwn(instance, LOADED)) {
		return undefined;
	}

	const marker: unknown = Reflect.get(instance, LOADED);

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
	instance: T,
	relation: string,
	value: unknown,
): T => {
	if (value === undefined) {
		throw new Error(
			`veto: markLoaded("${relation}", undefined) is ambiguous — undefined means "not loaded". Pass null for a loaded-but-empty relation.`,
		);
	}

	const loaded = new Set(loadedRelationNames(instance));

	loaded.add(relation);

	return Object.assign(
		{ ...instance },
		{ [relation]: value, [LOADED]: loaded },
	);
};

export const isLoaded = (instance: Row, relation: string): boolean => {
	return loadedRelationNames(instance)?.has(relation) ?? false;
};
