# Migrating from CASL

**[English](migrate-from-casl.md) · [Русский](migrate-from-casl.ru.md)**

Checked against `@casl/ability@7.0.1` and `@casl/react@7.0.1`.

Most of this is mechanical. One idea underneath it is not, and understanding it first makes the rest obvious.

## The one thing that changes

In CASL an ability is a **class instance**, and an object is tagged by mutating it. In Veto an ability is **closures over plain data**, and the resource name is an argument.

```ts
// CASL — the object is tagged
ability.can("update", subject("Post", post));

// Veto — the name is passed
ability.can("update", "post", post);
```

That single difference is why the rest of the migration goes the way it does: nothing wraps your objects, `ability.rules` is JSON you can send anywhere, and a server component can hand its rules to the client with no serialisation dance.

## Declaring the domain

CASL infers nothing — you hand-write the type algebra and the shapes:

```ts
type Abilities = ["read" | "update", "Post" | Post] | ["read", "User" | User];
const ability = createMongoAbility<MongoAbility<Abilities>>(rules);
```

Veto takes one declaration and derives everything from it:

```ts
const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published" }>(),
			actions: ["read", "update"],
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});
```

Resource names are lowercase strings here, not class names — they are keys in your declaration, so `"post"` rather than `"Post"`.

## Writing rules

```ts
// CASL
const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
can("read", "Post", { status: "published" });
cannot("update", "Post", { status: "archived" });
const ability = build();
```

```ts
// Veto
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	deny("update", "post", { where: { status: "archived" } }),
];

const ability = buildAbility(ac, policyFor(currentUser));
```

Two differences worth noticing. Conditions live under `where`, because Veto separates *which rows* from *which fields and values* — see [writes](./mutations.md). And a policy is an ordinary function of the actor returning an array, so there is no builder to hold and no `build()` to remember.

## Conditions

CASL takes MongoDB query syntax. Veto takes a shorthand with named operators.

| CASL | Veto |
|---|---|
| `{ status: "published" }` | `{ status: "published" }` |
| `{ views: { $gt: 100 } }` | `{ views: { gt: 100 } }` |
| `$eq` `$ne` `$in` `$nin` | `eq` `ne` `in` `nin` |
| `$gt` `$gte` `$lt` `$lte` | `gt` `gte` `lt` `lte` |
| `{ deletedAt: { $exists: false } }` | `{ deletedAt: { exists: false } }` |
| `{ $and: [...] }` `{ $or: [...] }` | `{ and: [...] }` `{ or: [...] }` |
| `{ $not: ... }` | `{ not: ... }` |
| `{ title: { $regex: /release/ } }` | `{ title: { contains: "release" } }` — substring only |
| `{ comments: { $elemMatch: { spam: true } } }` | `{ comments: { some: { spam: true } } }` — a declared [relation](./relations.md) |

**No equivalent, on purpose:** `$where` (arbitrary JavaScript inside a rule cannot be serialised, stored or compiled to SQL), `$regex` beyond a substring, `$size`, `$mod`, `$all`, `$nor`.

If you rely on one of those, the honest path is to lift it into a field your database can also filter on — a `commentCount` column instead of `$size`, a boolean flag instead of `$where`.

## Checking

```ts
// CASL
ability.can("update", subject("Post", post));
ability.can("read", "Post");             // by subject type
ability.cannot("delete", subject("Post", post));
```

```ts
// Veto
ability.can("update", "post", post);
ability.can("read", "post");             // without a row
ability.cannot("delete", "post", post);
ability.authorize("delete", "post", post); // throws ForbiddenError
```

The row-less form answers *could this be allowed for any row at all* — it is for deciding whether to render a control, not for guarding an operation on a specific row. If you have the row, pass it.

**Field-level checks.** CASL's `can("update", post, "title")` has no direct twin. Veto separates the questions: `ability.permittedFields("update", "post", fields)` for the UI, and `ability.validatePayload(...)` on the server, which returns the validated data or the exact violations. See [writes](./mutations.md).

## React

`@casl/react` exports `AbilityProvider`, `Can` and `useAbility`. So does Veto — with one structural difference that matters in Next.js.

```tsx
// CASL — the provider takes the ability instance
<AbilityProvider value={ability}>
	<App />
</AbilityProvider>
```

```tsx
// Veto — the provider takes rules, which are JSON
<AbilityProvider rules={ability.rules}>
	<App />
</AbilityProvider>
```

That is the fix for the error CASL users hit on Next 15 ([#999](https://github.com/stalniy/casl/issues/999)):

> Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.

A `PureAbility` is a class instance and cannot cross that boundary. `ability.rules` is an array of plain objects, so it can — and the client rebuilds from it.

Bindings come from a factory, because the types need your `ac`:

```ts
// src/veto.ts
export const { AbilityProvider, useAbility, useCan, useSetRules, Can } =
	createVetoContext(ac);
```

### `<Can>` props

| CASL | Veto |
|---|---|
| `<Can I="update" a="Post">` | `<Can I="update" a="post">` |
| `<Can I="update" an="Article">` | `<Can I="update" a="article">` — no `an` |
| `<Can I="update" this={post}>` | `<Can I="update" a="post" this={post}>` — the resource is always named |
| `<Can do="update" on="Post">` | not supported — use `I` / `a` |
| `<Can not>` | use `fallback`, or `useCan` and branch |
| `<Can passThrough>` | not supported |
| `{({ isAllowed }) => ...}` | not supported — use `useCan` |
| `field="title"` | `permittedFields` |
| — | `fallback={<ReadOnly />}` |
| — | `ability={ability}` — skip the context entirely |

### Server components

This has no CASL counterpart, and it is the reason most of this migration is worth doing:

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>
```

No provider, no context, no `"use client"`, and nothing shipped to the browser — both branches are decided while rendering. Build the ability once per request with React's `cache`.

### Re-rendering

CASL's `useAbility` re-renders every consumer whenever the ability changes. Veto's does too, deliberately — it hands back the whole object. When you only need one answer, `useCan` subscribes to that verdict alone:

```tsx
const canEdit = useCan("update", "post", post);
```

On a list of 50 gated rows where one verdict flips, that is 1 re-render instead of 50. To switch actors without re-rendering the page at all, use `useSetRules` instead of passing new `rules` down.

## Database queries

```ts
// CASL — via an adapter for your ORM
const posts = await prisma.post.findMany({ where: accessibleBy(ability).Post });
```

```ts
// Veto — a plain condition tree
const condition = ability.where("read", "post");
```

`where()` returns data, not a query. `@vetojs/drizzle` compiles it to SQL with a tested guarantee that the query returns exactly the rows `can()` allows; without an adapter you can walk the tree yourself. That is the difference from waiting on an adapter release for your ORM's next major.

## Behaviour that differs

Two things will change what your policy actually does. Both are deliberate, and both fail closed.

**Wrong-typed values.** In CASL a condition can quietly evaluate the wrong way:

```ts
// CASL: passes, because "100" is compared as a string
ability.can("read", subject("Post", { views: "100" }));   // rule: { views: { $gt: 50 } }

// CASL: the deny does not fire on a wrong-typed value
ability.can("read", subject("Post", { secret: "true" })); // deny rule: { secret: true }
```

Veto answers **unknown** for a present value of the wrong type: an `allow` grants nothing and a `deny` still fires. Corrupt data can only ever narrow access. See [operators](./operators.md).

**Relations must be loaded.** If a rule reads `post.author.role` and the author was not loaded, Veto throws `RelationNotLoadedError` rather than silently answering "doesn't match". A forgotten `include` is a bug in your query, not a policy change. See [relations](./relations.md).

## Rules from a database

If you store rules as JSON, validate them at the boundary before building:

```ts
const result = parseRules(JSON.parse(raw));
if (!result.ok) throw new Error(result.errors.join("\n"));
const ability = buildAbility(ac, result.rules);
```

`buildAbility` accepts only rules that provably passed a check — from `createRules` or from `parseRules`. See [rules from outside](./parse.md).

## Checklist

1. Replace the ability type algebra with one `defineAbilities` call; rename subjects to lowercase resource keys.
2. Turn the builder into a function of the actor returning an array; move conditions under `where`.
3. Translate operators (drop the `$`); rewrite `$elemMatch` as a declared relation; find replacements for `$where`, `$regex`, `$size`, `$mod`, `$all`.
4. Drop `subject()` everywhere and pass the resource name as the second argument.
5. Change the provider from `value={ability}` to `rules={ability.rules}`; move server-side gating to `@vetojs/react/server`.
6. Swap `accessibleBy` for `ability.where()` plus an adapter.
7. Re-run your authorization tests — the wrong-typed-value cases are where behaviour changes.
