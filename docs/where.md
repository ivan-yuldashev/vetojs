# Filtering in the database — `where()`

**[English](where.md) · [Русский](where.ru.md)**

Checking rows one by one only works once you have them. For a list you want the opposite: let the database return only what the actor may see. `ability.where(action, resource)` gives you that condition.

```ts
const filter = ability.where("read", "post");
```

The result is a plain condition tree, the same shape rules already use. A database adapter turns it into a real `WHERE` — with the [Drizzle adapter](./drizzle.md) that's one call:

```ts
const rows = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post"));
```

## The guarantee

The filter selects **exactly** the rows `can()` would allow. Not a superset you still have to re-check, not a subset that hides legitimate rows:

```
can(action, resource, row)   ⟺   row matches where(action, resource)
```

That equivalence is the whole point of this mode, and it's verified by a conformance test that runs both paths over a grid of rows — including messy ones with nulls, absent fields and wrong-typed values — asserting the two sets are identical. The Drizzle adapter runs the same grid against real Postgres.

## How rules become one condition

```
( any allow condition holds )  AND NOT  ( any deny condition holds )
```

That's it — no solver, no normalisation pass. It works because the [decision rules are fixed](./rule-evaluation.md): deny always wins, everything else defaults to denied.

Some cases collapse:

| Rules | Filter |
|---|---|
| no allow applies | matches nothing |
| an unconditional allow (e.g. `manage`) | just `NOT(denies)` |
| an unconditional deny | matches nothing |
| allows plus conditional denies | `allows AND NOT denies` |

"Matches nothing" and "matches everything" need no special node: an empty `or` can never be satisfied, and an empty `and` can never be violated.

## A row is visible only on a definite yes

The filter is a condition, not a boolean — and a condition can also answer "unknown" on incoherent data. A row is included **only when the answer is a definite yes**; unknown excludes it.

This is exactly how SQL already behaves — `WHERE` drops rows where the predicate is `FALSE` *or* `UNKNOWN` — and it's what keeps the two modes identical rather than merely similar.

**If you write your own adapter**, this is the contract to honour: compile a type mismatch to SQL's `UNKNOWN` rather than coercing it. Postgres comparing `'5000' > 1000` as numbers would admit a row the in-memory check denies, and the guarantee above would quietly stop being true.

## Why it works this way

- **`where()` needs no row** — it *is* the query condition. The row-level answer is `can()`; these are the two honest modes, and they agree by construction.
- **True and false reuse the existing empty combinators**, so every consumer already handles them without a new node type.

## Source

[`compile/where.ts`](../packages/core/src/compile/where.ts) · [tests](../packages/core/tests/api/where.test.ts) · [conformance](../packages/core/tests/conformance.test.ts)
