# Migrating from CASL

**[English](migrate-from-casl.md) · [Русский](migrate-from-casl.ru.md)**

Checked against `@casl/ability@7.0.1` and `@casl/react@7.0.1`.

In CASL an ability is a class instance and an object is tagged by mutating it. In veto an ability is closures over plain data, and the resource name is an argument:

```ts
// CASL
ability.can("update", subject("Post", post));

// veto
ability.can("update", "post", post);
```

Nothing wraps your objects, and `ability.rules` is JSON you can send anywhere.

## Declaring the domain

CASL takes hand-written type algebra:

```ts
type Abilities = ["read" | "update", "Post" | Post] | ["read", "User" | User];
const ability = createMongoAbility<MongoAbility<Abilities>>(rules);
```

veto takes one declaration and infers the rest:

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

Resources are keys of the declaration — `"post"`, not `"Post"`.

## Rules

```ts
// CASL
const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
can("read", "Post", { status: "published" });
cannot("update", "Post", { status: "archived" });
const ability = build();
```

```ts
// veto
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	deny("update", "post", { where: { status: "archived" } }),
];

const ability = buildAbility(ac, policyFor(currentUser));
```

Conditions go under `where`, apart from fields and values ([writes](./mutations.md)). A policy is a function returning an array — no builder, no `build()`.

## Conditions

| CASL | veto |
|---|---|
| `{ views: { $gt: 100 } }` | `{ views: { gt: 100 } }` |
| `$eq $ne $in $nin $gt $gte $lt $lte` | `eq ne in nin gt gte lt lte` |
| `{ $exists: false }` | `{ exists: false }` |
| `$and` `$or` `$not` | `and` `or` `not` |
| `{ $regex: /release/ }` | `{ contains: "release" }` — substring only |
| `{ comments: { $elemMatch: { spam: true } } }` | `{ comments: { some: { spam: true } } }` — a declared [relation](./relations.md) |

No equivalent: `$where`, `$regex` beyond a substring, `$size`, `$mod`, `$all`, `$nor` — none can be stored as data or compiled to SQL. Lift such a condition into a column: `commentCount` instead of `$size`, a flag instead of `$where`. To compare two fields of a row, use [`ref`](./conditions.md#comparing-two-fields).

## Checking

```ts
ability.can("update", "post", post);
ability.can("read", "post");               // without a row — for rendering decisions
ability.authorize("delete", "post", post); // throws ForbiddenError
```

CASL's `can("update", post, "title")` becomes `permittedFields("update", "post", post, fields)` for a form and `validatePayload` on the server.

## React

```tsx
// CASL: the provider takes the instance
<AbilityProvider value={ability}>

// veto: the provider takes rules, which are JSON
<AbilityProvider rules={ability.rules}>
```

A CASL ability is a class instance, so Next refuses to pass it from a server component to a client one ([casl#999](https://github.com/stalniy/casl/issues/999)). `ability.rules` crosses as is. Bindings come from `createVetoContext(ac)`.

| CASL `<Can>` | veto `<Can>` |
|---|---|
| `I="update" a="Post"`, `an="Article"` | `I="update" a="post"` |
| `I="update" this={post}` | `I="update" a="post" this={post}` — the resource is always named |
| `not`, `passThrough`, render props | `fallback`, or `useCan` and branch |
| `field="title"` | `permittedFields` |
| — | `ability={ability}` — skip the context |

A server component uses `Can` from `@vetojs/react/server`: no provider, no `"use client"`, both branches decided on the server. `useCan` re-renders only when its one verdict flips, where `useAbility` — like CASL's — re-renders on every change.

## Database queries

```ts
// CASL: an adapter per ORM
const rows = await prisma.post.findMany({ where: accessibleBy(ability).Post });

// veto: a condition tree; @vetojs/drizzle compiles it
const filter = ability.where("read", "post");
```

## Behaviour that differs

**Wrong-typed values.** CASL compares `{ views: "100" }` against `{ $gt: 50 }` and grants; a `deny` on `secret: true` does not fire for `secret: "true"`. veto answers unknown: an `allow` grants nothing, a `deny` fires.

**Relations must be loaded.** A rule reading `post.author.role` on a post without its author throws `RelationNotLoadedError` instead of answering "doesn't match".

## Checklist

1. Replace the type algebra with one `defineAbilities`; rename subjects to lowercase keys.
2. Turn the builder into a function of the actor; move conditions under `where`.
3. Drop the `$` from operators; rewrite `$elemMatch` as a relation; replace `$where`, `$regex`, `$size`, `$mod`, `$all`.
4. Drop `subject()` and pass the resource name.
5. Give the provider `rules={ability.rules}`; gate server components with `@vetojs/react/server`.
6. Replace `accessibleBy` with `ability.where()` and an adapter.
7. Rerun your authorization tests — wrong-typed values are where answers change.
