type EmptyAs<Raw> = null extends Raw ? null : never;

type RelationShape<Raw> =
	NonNullable<Raw> extends readonly (infer Item)[]
		? readonly [] | readonly [LoadedRelations<Item>] | EmptyAs<Raw>
		: NonNullable<Raw> extends object
			? LoadedRelations<NonNullable<Raw>> | EmptyAs<Raw>
			: never;

/**
 * The relations a row was loaded with, written as the row would look with each of them
 * empty: `null` for an empty to-one, `[]` for an empty list, an object to go into the related
 * row, `[{ … }]` to go into every row of a list. Checked against the row's type, so a list
 * cannot be emptied as `null` unless the type allows it.
 *
 * @example
 * const loaded = { author: null, blog: null, comments: [{ author: null }] } satisfies LoadedRelations<Post>;
 */
export type LoadedRelations<T> = { [K in keyof T]?: RelationShape<T[K]> };
