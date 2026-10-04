# Field shorthand

**[English](condition-shorthand.md) · [Русский](condition-shorthand.ru.md)**

Conditions are written as objects, not as syntax trees. `{ status: "published" }` says what it means; the tree form `{ field: "status", op: "eq", value: "published" }` is what gets stored. This page is the small language in between.

```ts
{ status: "published" }        // a plain value means "equals"
{ views: { gt: 100 } }         // an operator object
{ status: "draft", views: 0 }  // sibling keys are ANDed
```

## Which operators a field accepts

Operators are offered based on the field's type, so the wrong one is a compile error rather than a rule that never matches:

| Field type | Available |
|---|---|
| any | `eq` `ne` `in` `nin` `exists` |
| `number`, `Date` | plus `gt` `gte` `lt` `lte` |
| `string` | plus `contains` |

```ts
allow("read", "post", { where: { title: { gt: 5 } } });       // ✗ no ordering on strings
allow("read", "post", { where: { views: { contains: 1 } } }); // ✗ contains is string-only
```

For a union field such as `status: "draft" | "published"`, any member of the union is accepted.

## Values vs operator objects

A value is treated as an operator object only if it is a plain object with exactly one key, and that key is one of the thirteen operators. Everything else is a value to compare against:

```ts
{ tags: ["a", "b"] }         // compares against this array — always unknown
{ tags: { in: ["a", "b"] } } // membership — probably what you wanted
{ createdAt: someDate }      // equals this date
```

Arrays and `Date`s are values, never operators.

A `Date` compares by timestamp. An array or an object never compares to anything: two structurally identical objects are different references, so answering "not equal" would be a guess, and the engine answers **unknown** instead — which grants nothing and fires every `deny`. The type system rejects a bare array on an array-typed field for exactly this reason; reach for `in` or a [relation](./relations.md).

## Dates become numbers

A `Date` anywhere in a condition — direct, inside an operator object, or as a member of an `in` list — is stored as its epoch-millisecond number. That keeps the rule pure JSON, so it survives `JSON.stringify` and a trip through a database unchanged.

You don't have to think about it when checking: a `Date` field from your ORM compares correctly against the stored number, and vice versa.

## Two places it's used

- **`where`** — full version: fields, plus relation keys and `and` / `or` / `not`. See [conditions](./conditions.md) and [relations](./relations.md).
- **`values`** — restricted version: fields and `and` only. Value authorization is a flat list of allowed values; `or` and `not` over it would express prohibitions that belong in a `deny` rule instead. See [mutations](./mutations.md).

## Why it works this way

- **The shorthand is compiled when the rule is built**, not when it is evaluated. Nothing shorthand-shaped is ever stored, sent over the wire, or handed to the SQL compiler — those all see the same plain tree.
- **A bare value means `eq`** because that is the overwhelmingly common case, and `{ status: { eq: "published" } }` adds noise without adding meaning.

## Source

[`create/condition-shorthand.ts`](../packages/core/src/create/condition-shorthand.ts) · [`create/where-input.ts`](../packages/core/src/create/where-input.ts) · tests: [where-input](../packages/core/tests/create/where-input.test.ts), [mutations](../packages/core/tests/api/mutation.test.ts)
