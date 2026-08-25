# Conditions across relations

**[English](relations.md) · [Русский](relations.ru.md)**

Plenty of real rules aren't about the row itself: *the post's blog belongs to my workspace*, *none of its comments are flagged as spam*. A relation is just another key in `where`.

```ts
allow("update", "post", {
	where: {
		status: "published",                     // a field
		author: { role: "admin" },               // to-one relation
		comments: { none: { spam: true } },      // to-many relation
	},
});
```

Because `createRules(ac)` knows your declarations, it can tell a field from a to-one from a to-many — and so can TypeScript. A wrong relation name, a to-one used where a to-many belongs, or a typo in a related resource's field is a compile error.

Relations nest as deep as you declared them:

```ts
where: { blog: { workspace: { id: workspaceId } } }
```

## Quantifiers

A to-many relation needs to say *how many* related rows must match:

| | Holds when |
|---|---|
| `some` | at least one related row matches |
| `every` | all of them match |
| `none` | none of them match |

Over an empty collection: `some` is false, `every` and `none` are true — the usual reading of "all of nothing" and "none of nothing".

A to-one relation takes no quantifier; you nest the condition directly, and it holds when that single related row satisfies it.

## Loading relations is your job — and forgetting is loud

To answer *is this post's author an admin?* the author has to actually be on the object. If it isn't, the engine **throws** `RelationNotLoadedError` instead of deciding.

That is deliberate. The alternative — treating missing data as "doesn't match" — turns a forgotten `include` into a silent policy change, and for a `deny` it means the prohibition quietly stops applying.

The engine reads the same convention your ORM already follows:

| What's on the object | Read as | Result |
|---|---|---|
| `undefined` (key absent) | not loaded | **throws** |
| `null` | loaded, nothing there | empty collection |
| an object, or array of objects | loaded | evaluated normally |
| a string / number / bigint | you selected ids, not rows | **throws** — the relation isn't really loaded |
| anything else | corrupt data | unknown → an allow grants nothing, a deny fires |

Prisma, Drizzle and TypeORM all follow it: `include`/`with` gives you objects or `null`, and a relation you didn't ask for is `undefined`.

What the engine reads is plain data — an object whose prototype is `Object.prototype`, or none at all. Prisma and Drizzle hand you exactly that. TypeORM hands you entity **class instances**, and a check on one answers no: the engine does not read fields through a prototype it doesn't know. Spread the entity on the way in:

```ts
const entity = await repository.findOne({
	where: { id: postId },
	relations: { author: true },
});

ability.can("read", "post", { ...entity });
```

```ts
const post = await db.query.posts.findFirst({
	where: eq(posts.id, id),
	with: { author: true, comments: true },   // needed by the rules above
});

ability.can("update", "post", post);
```

## `markLoaded` — when the convention doesn't apply

For hand-assembled objects, or an ORM that breaks the convention, state it explicitly:

```ts
import { markLoaded } from "@vetojs/core";

const withAuthor = markLoaded(post, "author", author);
const withoutBlog = markLoaded(post, "blog", null); // loaded, and empty
```

It returns a **copy** — your input is not mutated — carrying the value plus an invisible marker (a global symbol, so `Object.keys` and `JSON.stringify` don't see it).

Passing `undefined` as the value throws: `undefined` is precisely what "not loaded" means, so marking a relation loaded with it is a contradiction. Use `null` for loaded-but-empty.

## Why it works this way

- **Missing data throws; it never returns "no match".** A forgotten `include` is a bug in your query, and bugs that quietly change authorization outcomes are the worst kind.
- **An id where an object was expected also throws.** Selecting `authorId` instead of the author is the most common form of "not loaded" — it deserves the same loud failure, not a comparison against a string.
- **Other garbage is "unknown", not an error.** A boolean or a stray `null` inside the array isn't a load state, it's corrupt data — so it fails closed both ways instead of crashing the request.
- **Nesting is free.** A relation's `where` is an ordinary condition, so relations inside relations need no special handling.

## Source

[`evaluation/condition.ts`](../packages/core/src/evaluation/condition.ts) · [`errors/relation-not-loaded.ts`](../packages/core/src/errors/relation-not-loaded.ts) · tests: [conditions](../packages/core/tests/evaluation/condition.test.ts), [loaded](../packages/core/tests/evaluation/loaded.test.ts)

In SQL these compile to `EXISTS` / `NOT EXISTS` subqueries, handled by a database adapter.
