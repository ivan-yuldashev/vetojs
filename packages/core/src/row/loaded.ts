import type { Row } from "../model/index.js";
import { isRow, own } from "../shared/index.js";
import type { LoadedRelations } from "./loaded.types.js";

type MarkLoaded = {
	<T extends Row>(row: T, relations: LoadedRelations<T>): T;
	<T extends Row>(row: T, relation: string, value: unknown): T;
};

const fillRow = <T extends Row>(row: T, relations: object): T => {
	const source: Row = row;

	return {
		...row,
		...Object.fromEntries(
			Object.entries(relations)
				.filter(([, shape]) => shape !== undefined)
				.map(([relation, shape]) => [
					relation,
					fillRelation(own(source, relation), shape),
				]),
		),
	};
};

const fillRelation = (value: unknown, shape: unknown): unknown => {
	if (value === undefined) {
		return Array.isArray(shape) ? [] : null;
	}

	if (!Array.isArray(shape)) {
		return isRow(shape) && isRow(value) ? fillRow(value, shape) : value;
	}

	const [item]: unknown[] = shape;

	return isRow(item) && Array.isArray(value)
		? value.map((entry) => (isRow(entry) ? fillRow(entry, item) : entry))
		: value;
};

/**
 * States which relations a row was loaded with, for data that dropped the empty ones.
 *
 * The engine reads the convention Prisma, Drizzle and TypeORM already follow — `undefined`
 * means not loaded (and a check needing it throws), `null` or `[]` means loaded and empty.
 * A serializer that omits empty fields — `jsonb_strip_nulls`, Go's `omitempty`, Jackson's
 * `NON_NULL`, protobuf JSON — leaves a loaded relation looking unloaded. Name the relations
 * you loaded, written as the empty row would look, and every one that is missing is filled
 * with that empty value. Present values are left as they are, and a relation you do not
 * name stays unloaded.
 *
 * Also takes one relation and its value, to attach related rows you loaded yourself.
 *
 * Returns a **copy**; your input is not mutated.
 *
 * @param relations - the loaded relations, see {@link LoadedRelations}
 * @throws {Error} if a single `value` is `undefined` — that is precisely what "not loaded"
 *   means, so marking a relation loaded with it is a contradiction
 *
 * @example
 * const ready = markLoaded(post, { author: null, blog: null, comments: [{ author: null }] });
 * const withAuthor = markLoaded(post, "author", author);
 */
export const markLoaded: MarkLoaded = <T extends Row>(
	row: T,
	relations: string | LoadedRelations<T>,
	value?: unknown,
): T => {
	if (typeof relations !== "string") {
		return fillRow(row, relations);
	}

	if (value === undefined) {
		throw new Error(
			`veto: markLoaded("${relations}", undefined) is ambiguous — undefined means "not loaded". Pass null for a loaded-but-empty relation.`,
		);
	}

	return { ...row, [relations]: value };
};
