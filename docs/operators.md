# Condition operators

**[English](operators.md) · [Русский](operators.ru.md)**

Every condition in a rule ends in a comparison: *is this field equal to that value, greater than it, one of these?* There are thirteen operators, and this page is what each one does — including the awkward cases (`null`, wrong types, `NaN`) where getting it wrong would quietly hand out access.

You write operators in the shorthand:

```ts
allow("read", "post", { where: { status: "published" } });        // eq, implicit
allow("read", "post", { where: { views: { gte: 100 } } });        // explicit operator
allow("read", "post", { where: { status: { in: ["draft", "review"] } } });
```

## The thirteen operators

| Operator | True when | Notes |
|---|---|---|
| `eq` | values are equal | `Date` compares by timestamp (also against an epoch-ms number), `1` equals `1n`; otherwise strict `===`. Strings are case-sensitive; objects and arrays are **unknown**, never equal or unequal |
| `ne` | not `eq` | |
| `in` | the value is in the list | membership uses `eq` equality |
| `nin` | the value is not in the list | |
| `gt` `gte` `lt` `lte` | ordered comparison | numbers, bigints, dates, or strings |
| `contains` | the string contains the substring | string-only, case-sensitive |
| `exists` | presence matches what you asked for | takes `true` or `false`, nothing else; `exists: true` means not `null`/`undefined`, so `0`, `false` and `""` count as present |
| `has` | the array contains the element | array-of-scalars fields only |
| `hasAny` | the array contains at least one of the list | shorthand for `or` over `has` |
| `hasAll` | the array contains every one of the list | shorthand for `and` over `has`; an empty list asks nothing of the elements, so any array satisfies it — an absent field still does not |

## Comparing values that don't line up

Real data is messy: a column is `NULL`, a JSON payload sends `"5000"` where a number belongs, a rule from the database carries a broken list. Each operator answers one of three ways:

- **yes** / **no** — a decidable answer;
- **unknown** — the data and the condition are incoherent, so no honest yes/no exists.

"Unknown" is not a technicality — it is the safety mechanism. An `allow` grants nothing on unknown, and a `deny` **still fires**. Both directions fail closed, so corrupt data can only ever narrow access. (See [rule evaluation](./rule-evaluation.md) for how the three states combine.)

Where each answer comes from:

| Situation | Answer | Why |
|---|---|---|
| The field is `null` / missing, under `gt` / `lt` / `contains` | **no** | "no value" decidably doesn't exceed anything |
| `views > "abc"` — a number against a string | **unknown** | there is no meaningful ordering between them |
| `NaN`, or an invalid `Date` | **unknown** | nothing orders against it, so no comparison can settle |
| `status in "draft"` — the list isn't a list | **unknown** | the rule is malformed; see below |
| An operator the engine doesn't know | **no** | malformed rules deny, they don't crash |

### Ordering details

Before comparing, operands are normalised: numbers, bigints and strings are used as-is; a `Date` becomes its timestamp, so a `Date` and an epoch-ms number are the same kind of thing. A comparison only runs when both sides are numeric or both are strings — anything else is unknown.

### Why `nin` on a broken list is "unknown", not "yes"

If a malformed list answered a plain **no** for `in`, then `nin` — its negation — would answer **yes**, and a broken rule would start granting access. Unknown is the only answer that stays safe when negated. (`parseRules` also rejects such rules at the trust boundary, so this is the second line of defence.)

## Why it works this way

- **Comparisons never throw and never coerce.** Postgres would happily compare `'200'` to `200`; JavaScript would compare `"10" < "9"` as strings. The engine refuses both — a wrong-typed value is unknown, not a silent match.
- **`Date` and `number` are interchangeable.** Rules serialise a `Date` as epoch milliseconds so they survive `JSON.stringify` (see [condition shorthand](./condition-shorthand.md)), but a check against a real `Date` from your ORM still works. Both carriers compare by value.
- **`1` equals `1n`.** Numeric ids cross the `number`/`bigint` boundary all the time; making them unequal would be a footgun. The check is exactness, not size — `1.5` never equals a bigint.
- **`exists` asks about presence, not truthiness.** `0` and `""` are values a row legitimately holds; treating them as absent would deny real rows.
- **An array field is asked about its elements, never compared whole.** `has` / `hasAny` / `hasAll` are the only comparisons offered for one, and the type system removes the rest — `eq` against an array could only ever answer unknown. A present non-array answers unknown too, so neither polarity can decide on the wrong shape; an absent field is a decidable miss. Postgres translates all three to a single indexable operator, so the SQL and the engine agree row for row.
- **An object or array operand is unknown, not unequal.** These operators compare values, and two structurally identical objects are not the same reference — so answering "not equal" would be a guess dressed as a fact. It used to answer `false`, which quietly disarmed every `deny` on such a field: the prohibition never applied, whatever the row held. Unknown is the honest answer, and it fails closed in both polarities. If you need to match inside a nested object, model it as a [relation](./relations.md) — the engine compares scalars, and a database adapter refuses to compile an object comparison at all.

## Source

[`evaluation/operator.ts`](../packages/core/src/evaluation/operator.ts) · [tests](../packages/core/tests/evaluation/operator.test.ts)

`ConditionOperator` is exported from `@vetojs/core` for database adapters; the evaluator itself is internal — you reach it through `ability.can(...)`.
