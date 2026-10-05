# Conditions

**[English](conditions.md) · [Русский](conditions.ru.md)**

A condition is a plain object: keys are fields, values are what to compare against.

```ts
allow("update", "post", {
	where: {
		status: "draft",                           // equals
		views: { lt: 100 },                        // an operator
		authorId: { in: [actor.id, "u2"] },
		or: [{ pinned: true }, { featured: true }],
		author: { role: "admin" },                 // a relation
	},
});
```

Sibling keys mean **and**; `and`, `or` and `not` group explicitly. A key naming a [relation](./relations.md) steps into the related row.

## Operators by field type

| Field | Operators |
|---|---|
| any scalar | `eq ne in nin exists`, and a bare value for `eq` |
| `number`, `Date` | also `gt gte lt lte` |
| `string` | also `contains` |
| array of scalars | `has hasAny hasAll exists` |
| object, or array of objects | `exists` |

Only these type-check, one operator per field. What each does on `null`, wrong types and `NaN` is on [operators](./operators.md).

An array field is asked about its members — `{ tags: { has: "release" } }`. A bare array, `{ tags: ["a"] }`, does not compile: a whole array never compares to anything.

## Comparing two fields

Put `{ ref }` in place of a value to compare two fields of the same row, under `eq`, `ne`, `gt`, `gte`, `lt` or `lte`:

```ts
const ac = defineAbilities({
	resources: { invoice: { schema: shape<{ spent: number; limit: number }>(), actions: ["update"] } },
});
const { allow } = createRules(ac);

allow("update", "invoice", { where: { spent: { lte: { ref: "limit" } } } });
// stored as { field: "spent", op: "lte", ref: "limit" }
```

The types offer only fields of a matching type; inside a relation both fields belong to the related row. When either side is missing, `null` or `NaN`, the answer is unknown — the way SQL answers `spent <= limit` with a `NULL` on either side — so `can()` and the compiled `WHERE` agree. `ref` is allowed in `where` only.

## The stored tree

The shorthand is compiled when the rule is built, and the rule stores this:

```ts
type ConditionNode =
	| { field: string; op: string; value: unknown }
	| { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; ref: string }
	| { relation: string; type: "one"; where: ConditionNode }
	| { relation: string; type: "many"; match: "some" | "every" | "none"; where: ConditionNode }
	| { and: ConditionNode[] }
	| { or: ConditionNode[] }
	| { not: ConditionNode };
```

A `Date` is stored as epoch milliseconds so the rule stays JSON, and a `Date` from your ORM still compares against it. `ability.where()` uses `{ and: [] }` for "every row" and `{ or: [] }` for "no row".

## Yes, no or unknown

A condition answers yes, no, or **unknown** when the data does not fit it — a wrong-typed field, a field the row lacks, a corrupt relation. `and` is no if any part is no, `or` is yes if any part is yes; otherwise an unknown part makes the whole unknown. `not` leaves unknown as it is, so wrapping a `deny` in `not` does not let bad data through. What a decision does with unknown is on [rule evaluation](./rule-evaluation.md#when-the-data-doesnt-fit).

## Where each form is allowed

| | fields | `and` | `or` / `not` | relations | `ref` |
|---|---|---|---|---|---|
| `where` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `values` — [writes](./mutations.md) | ✓ | ✓ | — | — | — |
| `when` — [environment](./define-abilities.md#the-requests-environment) | ✓ | ✓ | ✓ | — | — |

A forbidden value is a `deny` with `values`, not an `or` / `not` inside a constraint.

## Why it works this way

- **Compiled at construction.** The engine, the SQL adapter and the database all see one plain tree.
- **A bare value means `eq`**, because that is the common case.
- **A node carries exactly one shape.** [`parseRules`](./parse.md) refuses a node naming both a field and `and`, which a reader would otherwise half-drop.

## Source

[`create/where-input.ts`](../packages/core/src/create/where-input.ts) · [`create/condition-shorthand.ts`](../packages/core/src/create/condition-shorthand.ts) · [`model/condition.ts`](../packages/core/src/model/condition.ts) · [tests](../packages/core/tests/create/where-input.test.ts)
