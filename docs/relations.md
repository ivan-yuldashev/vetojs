# Relations

**[English](relations.md) · [Русский](relations.ru.md)**

A relation declared in [`defineAbilities`](./define-abilities.md) is another key in `where`:

```ts
allow("update", "post", {
	where: {
		author: { role: "admin" },                           // to-one
		comments: { none: { spam: true } },                  // to-many
		blog: { workspace: { id: { in: workspaceIds } } },   // nested
	},
});
```

A wrong relation name, a field the related resource lacks, or a to-many without a quantifier does not compile.

| To-many quantifier | Holds when | On an empty list |
|---|---|---|
| `some` | at least one related row matches | no |
| `every` | all of them match | yes |
| `none` | none of them match | yes |

A to-one relation takes the condition directly.

## Load what the rules read

If a rule reads `post.author.role`, the author has to be on the row. When it is not, `can()` **throws** `RelationNotLoadedError` instead of deciding, even if another part of the condition already settled the answer:

```ts
const post = await db.query.posts.findFirst({
	where: eq(posts.id, id),
	with: { author: true, comments: true },
});

ability.can("update", "post", post);
```

| On the row | Read as |
|---|---|
| no key, or `undefined` | not loaded — throws |
| a string or a number | an id, not a row — throws |
| `null` | loaded and empty: a to-one matches nothing, a to-many is an empty list |
| an object, or an array of objects | loaded |
| anything else | corrupt — unknown: an `allow` grants nothing, a `deny` fires |

Prisma and Drizzle return rows in this form. The engine reads plain objects only, so convert class instances — TypeORM entities — with `structuredClone(entity)`, which also turns the related entities into plain objects. A spread copies only the top level.

A row assembled by hand needs the relation key set: `{ ...post, author }`. `markLoaded(post, "author", author)` does the same and refuses `undefined`; pass `null` for loaded-but-empty.

In SQL a relation becomes an `EXISTS` subquery — see the [Drizzle adapter](./drizzle.md#relations).

## Relations a serializer dropped

Some sources leave empty values out: `jsonb_strip_nulls`, Go's `omitempty`, Jackson's `NON_NULL` and `NON_EMPTY`, protobuf JSON. A relation that was loaded and came back empty then has no key, and the check throws as if it had never been loaded. Name the relations you loaded, written as the row would look with each of them empty:

```ts
type Author = { id: string; role: string };
type PostFromApi = {
	id: string;
	author?: Author | null;
	comments?: { id: string; author?: Author | null }[];
};

const ready = markLoaded(json as PostFromApi, { author: null, comments: [{ author: null }] });
```

`null` fills a missing to-one and `[]` a missing list. An object goes into the related row, and `[{ … }]` into every row of a list. A value that is there stays as it is, and a relation you do not name stays unloaded. The shape is checked against the type of the row you pass — the data as it arrived, relations included: `comments: null` does not compile where that type keeps the list from being `null`. `LoadedRelations<PostFromApi>` names the shape, so it can live beside the request that fetches the rows.

## Why it works this way

- **A missing relation throws.** Reading it as "doesn't match" would turn a forgotten `include` into a policy change, and a `deny` would quietly stop applying.
- **An id where a row was expected throws too.** Selecting `authorId` instead of the author is the commonest way to forget a load.
- **Other garbage is unknown, not an error**, so corrupt data fails closed instead of crashing the request.
- **`markLoaded` fills only what you name.** A source that drops empty values cannot tell empty from never requested. Only the code that sent the query knows what it asked for, so the list comes from there, and a relation left off it still throws.

## Source

[`row/read.ts`](../packages/core/src/row/read.ts) · [`row/loaded.ts`](../packages/core/src/row/loaded.ts) · [`errors/relation-not-loaded.ts`](../packages/core/src/errors/relation-not-loaded.ts) · [tests](../packages/core/tests/row/loaded.test.ts)
