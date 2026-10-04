# Operators

**[English](operators.md) · [Русский](operators.ru.md)**

What each comparison answers, including on data that does not fit. How to write them is on [conditions](./conditions.md).

| Operator | Yes when | Notes |
|---|---|---|
| `eq` | the values are equal | a `Date` compares by timestamp, also against an epoch-ms number; `1` equals `1n`; strings are case-sensitive |
| `ne` | not `eq` | a missing or `null` field is not equal |
| `in` / `nin` | the value is / is not in the list | membership uses `eq` |
| `gt` `gte` `lt` `lte` | ordered comparison | both sides numeric (number, bigint, `Date`) or both strings |
| `contains` | the string contains the substring | case-sensitive |
| `exists` | present for `true`, absent for `false` | `0`, `false` and `""` are present |
| `has` | the array holds the element | |
| `hasAny` | the array holds at least one of the list | |
| `hasAll` | the array holds every one of the list | an empty list holds for any array, not for a missing field |

## When the data does not fit

| Data | Answer |
|---|---|
| the field is `null` or missing — under anything but `ne`, `nin`, `exists` | **no** |
| a number against a string, `NaN`, an invalid `Date` | **unknown** |
| an object or an array compared by value | **unknown** |
| `has` / `hasAny` / `hasAll` on a value that is not an array | **unknown** |
| `in` / `nin` whose list is not a list | **unknown** |
| an operator the engine does not know | **unknown** |

An `allow` grants nothing on unknown and a `deny` fires, so bad data can only narrow access — see [rule evaluation](./rule-evaluation.md#when-the-data-doesnt-fit). Rules carrying a malformed list or an unknown operator are refused earlier by [`parseRules`](./parse.md).

```ts
// deny("read", "post", { where: { secret: true } })
const row = JSON.parse('{ "id": "p1", "secret": "true" }');
ability.can("read", "post", row); // false — unknown, the deny fires
```

## Why it works this way

- **No coercion.** Postgres compares `'200'` with `200` as numbers, JavaScript compares `"10" < "9"` as strings. Here a wrong-typed value is unknown, never a silent match.
- **`nin` on a broken list is unknown, not yes.** A plain "no" for `in` would make its negation grant.
- **An object is unknown, not "not equal".** Two identical-looking objects are different references; answering "not equal" would disarm every `deny` on that field.
- **`1` equals `1n`**, because numeric ids cross between `number` and `bigint` all the time.

`ConditionOperator` is exported for code that walks `ability.where()` — a database adapter of your own.

## Source

[`verdict/operator.ts`](../packages/core/src/verdict/operator.ts) · [tests](../packages/core/tests/verdict/operator.test.ts)
