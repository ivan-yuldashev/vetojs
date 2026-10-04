# Declaring resources — `defineAbilities`

**[English](define-abilities.md) · [Русский](define-abilities.ru.md)**

Everything the library knows about your resources comes from one declaration: what resources exist, what you can do to them, and how they relate. Every type downstream — resource names, the actions valid for each one, the shape of a row — is inferred from it. You never hand-write a union or a tuple type.

```ts
import { defineAbilities, shape } from "@vetojs/core";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "create", "update", "delete", "publish"],
			relations: {
				blog: { resource: "blog", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		blog: { schema: shape<Blog>(), actions: ["read", "update"] },
		comment: { schema: shape<Comment>(), actions: ["read", "create", "delete"] },
	},
});
```

At runtime this returns the `resources` object unchanged — it is a typed identity function. All of its value is in the type it captures.

## What a resource carries

| Field | Meaning |
|---|---|
| `schema` | the row's own fields, optional — leave it out for a resource that has no rows ([see below](#a-resource-with-no-rows)). `shape<T>()` is a zero-runtime marker that only carries the type; pass a real [Standard Schema](https://standardschema.dev) instead if you also want runtime validation — [see below](#swapping-typet-for-a-real-schema) |
| `actions` | what can be done to this resource, captured as literals |
| `relations` | named links to other resources — `{ resource, kind }`, where `kind` is `"one"` or `"many"` |

Relation **names** are yours to choose; the **target** must be a resource you declared. Names live in their own namespace, separate from schema fields — the same split your ORM makes between columns and `include`/`with`.

## A resource with no rows

A screen, a report, a background job: something the policy decides about, with no record anywhere behind it. Leave `schema` out.

```ts
const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
		report: { actions: ["view", "export"] },
	},
});
```

Everything else is unchanged: `report` has its own actions, rules are written against it as usual, and `can("view", "report")` answers from those rules.

What changes is the shape, which is now empty — and that is the point. A row cannot be passed by mistake, and no condition can compare a field the resource never had:

```ts
const ac = defineAbilities({ resources: { report: { actions: ["view"] } } });
const { allow } = createRules(ac);
const ability = buildAbility(ac, []);

ability.can("view", "report", { id: "r1" });        // ✗ a resource with no rows has no row to pass
allow("view", "report", { where: { id: "r1" } });   // ✗ and no field to write a condition against
```

`ability.validate("report", data)` still answers — it accepts any object and refuses anything else, exactly as a `shape<T>()` without a validator does. A resource you never declared is still refused as unknown, so "declared, with nothing in it" and "not a resource" stay different answers.

The [Drizzle adapter](./drizzle.md#resources-without-a-table) is told the same thing separately: `defineTables(ac, { report: null })`. The declaration says the resource has no shape; the map says it has no table.

If the screen *is* keyed by something — a workspace id from the route — then it has a row after all, and the row is that key. Declare it: [gating a screen](./react.md#screens-and-tabs--resources-with-no-rows) is about exactly that case.

## Swapping `shape<T>()` for a real schema

`shape<T>()` is erased at build time — it carries the shape into the type system and checks nothing at runtime. Pass a [Standard Schema](https://standardschema.dev) instead and the same declaration also validates incoming data:

```ts
import { z } from "zod";

const post = z.object({
	id: z.string(),
	authorId: z.string(),
	status: z.enum(["draft", "published"]),
	views: z.number(),
});

const ac = defineAbilities({
	resources: { post: { schema: post, actions: ["read", "update"] } },
});
```

`ShapeOf<AC, "post">` is now inferred from the schema, so nothing is declared twice, and `ability.validate` starts doing real work:

```ts
ability.validate("post", { id: "p1", authorId: "u1", status: "published", views: 10 });
// → { ok: true, value: … }

ability.validate("post", { id: 1, status: "archived" });
// → { ok: false, issues: […] }
```

That is the other half of handling untrusted input, and the two halves answer different questions:

| | Question |
|---|---|
| `validate` | is this even a valid post? |
| `validatePayload` | may this actor write these fields and values? — see [writes](./mutations.md) |

Running only one of them is the common mistake. A payload can be perfectly shaped and still touch a field the actor may not write; it can also be permitted by the policy and still be nonsense.

> **The schema must validate synchronously.** Verified against Standard Schema v1: **Zod, Valibot and ArkType** work. **Yup does not** — it implements the standard, but its validation is async, and `validate` throws rather than return a promise you might forget to await.

Nothing else changes. Rules, evaluation and `can()` never consult the schema — the engine reads fields structurally and is total on any input, so a schema only ever adds a check at the boundary.

## What you get back

```ts
type AC = typeof ac;

ResourceName<AC>;      // "post" | "blog" | "comment"
ActionFor<AC, "post">;      // "read" | "create" | "update" | "delete" | "publish" | "manage" — what a rule names
DeclaredAction<AC, "post">; // "read" | "create" | "update" | "delete" | "publish" — what a question names
ShapeOf<AC, "post">;   // Post
```

These flow into `createRules(ac)` and `buildAbility(ac, …)`, which is why a typo in an action name or a field is a compile error rather than a rule that silently never matches.

## Why it works this way

- **`const` type parameter instead of `as const`.** The literal action names are captured for you, so the declaration stays clean.
- **Each resource keeps its own shape.** A single shared shape parameter would collapse resources of different shapes into one; here `ShapeOf` reads each `schema` individually.
- **`schema` carries a type, it isn't data.** `shape<T>()` exists purely to smuggle `T` into the type system at zero runtime cost. Swap in a Standard Schema when you want `ability.validate` to actually check incoming data — see [ability](./ability.md).
- **Rules referencing something you didn't declare are caught.** With typed factories it is a compile error. For rules arriving as JSON at runtime, the same check happens at the trust boundary — see [parse](./parse.md).

## Source

[`create/define-abilities.ts`](../packages/core/src/create/define-abilities.ts) · [`create/schema.ts`](../packages/core/src/create/schema.ts) · [tests](../packages/core/tests/create/define-abilities.test.ts)
