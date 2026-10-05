# Operators

**[English](operators.md) · [Русский](operators.ru.md)**

What each comparison answers, including on data that does not fit. How to write them is on [conditions](./conditions.md).

| Operator | Yes when | Notes |
|---|---|---|
| `eq` | the values are equal | a `Date` compares by timestamp, also against an epoch-ms number; `1` equals `1n`; strings are case-sensitive |
| `ne` | not `eq` | a `null` field is not equal to any other value |
| `in` / `nin` | the value is / is not in the list | membership uses `eq`; the list may hold `null` |
| `gt` `gte` `lt` `lte` | ordered comparison | both sides numeric (number, bigint, `Date`); strings are compared by equality only |
| `contains` | the string contains the substring | case-sensitive |
| `exists` | present for `true`, empty for `false` | `0`, `false` and `""` are present, `null` is empty |
| `has` | the array holds the element | |
| `hasAny` | the array holds at least one of the list | |
| `hasAll` | the array holds every one of the list | an empty list holds for any array |

## When the data does not fit

| Data | Answer |
|---|---|
| the field is missing or `undefined` — under every operator, `exists` included | **unknown** |
| the field is `null` — under anything but `ne`, `nin`, `exists` | **no** |
| a value of another type: `"5"` against `5`, `"true"` against `true` | **unknown** |
| `NaN`, an invalid `Date` | **unknown** |
| `gt` `gte` `lt` `lte` on two strings | **unknown** |
| an object or an array compared by value | **unknown** |
| an array element or a list member of another type, when no other one matches | **unknown** |
| `has` / `hasAny` / `hasAll` on a value that is not an array | **unknown** |
| `in` / `nin` whose list is not a list | **unknown** |
| an operator the engine does not know | **unknown** |

An `allow` grants nothing on unknown and a `deny` fires, so bad data can only narrow access — see [rule evaluation](./rule-evaluation.md#when-the-data-doesnt-fit). Rules carrying a malformed list, an unknown operator, `NaN` or ±`Infinity` are refused earlier by [`parseRules`](./parse.md).

```ts
// deny("read", "post", { where: { secret: true } })
const row = JSON.parse('{ "id": "p1", "secret": "true" }');
ability.can("read", "post", row); // false — unknown, the deny fires

// deny("read", "post", { where: { status: "archived" } })
ability.can("read", "post", { id: "p1" }); // false — status is missing, the deny fires
```

## `null` is a value

`eq null` holds only for a `null` field, and `ne null` for every other value. Against any value but itself, a `null` field is a plain no — the answer SQL gives for a `NULL` column. A missing field is not `null`: it says nothing about the value, so it is unknown.

| Rule | `null` | `"draft"` | missing |
|---|---|---|---|
| `{ status: "draft" }` | no | yes | unknown |
| `{ status: null }` | yes | no | unknown |
| `{ status: { ne: "draft" } }` | yes | no | unknown |
| `{ status: { ne: null } }` | no | yes | unknown |
| `{ status: { exists: false } }` | yes | no | unknown |

## Why it works this way

- **No coercion.** Postgres compares `'200'` with `200` as numbers, JavaScript compares `"10" < "9"` as strings. Here a wrong-typed value is unknown, never a silent match.
- **Strings are not ordered.** JavaScript orders them by code unit, Postgres by the database collation, and Drizzle returns `numeric`, `date` and `timestamp` columns as strings by default, where `"10000.00" <= "9000.00"` holds. An ordering on two strings is unknown, so a limit kept in such a column refuses rather than lets the row through.
- **A missing field is unknown, not no.** A row selected without the column, or from a serializer that drops keys, says nothing about the value. Reading it as "no" would let a `deny` on that field step aside and an `allow` with `ne` grant. Load the fields your rules read.
- **`null` is a value.** The database stores it, and `can()` answers it as SQL answers a `NULL` column, so the query and the check agree.
- **`nin` on a broken list is unknown, not yes.** A plain "no" for `in` would make its negation grant.
- **An object is unknown, not "not equal".** Two identical-looking objects are different references; answering "not equal" would disarm every `deny` on that field.
- **`1` equals `1n`**, because numeric ids cross between `number` and `bigint` all the time.

`ConditionOperator` is exported for code that walks `ability.where()` — a database adapter of your own.

## Source

[`verdict/operator.ts`](../packages/core/src/verdict/operator.ts) · [tests](../packages/core/tests/verdict/operator.test.ts)
