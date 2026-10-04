# How a decision is made

**[English](rule-evaluation.md) · [Русский](rule-evaluation.ru.md)**

> **A `deny` that applies always wins. Anything not allowed is denied.**

## Which rules take part

A rule takes part when its resource matches and its action does — named, in a list, or as `"manage"`. Then:

- its `where` is checked against the row; a rule without one applies to every row;
- its `when` is checked against the request's [environment](./define-abilities.md#the-requests-environment). An `allow` takes part only when its `when` holds; a `deny` drops out only when its `when` fails. A key the environment lacks fails nothing, so a missing value never lifts a prohibition. With no environment bound, an `allow` with `when` grants nothing and a `deny` with `when` stands.

## The decision

1. Any applicable `deny` → denied.
2. Otherwise any applicable `allow` → allowed.
3. Otherwise → denied.

```ts
const rules = [
	allow("update", "post"),
	deny("update", "post", { where: { status: "published" } }),
];

ability.can("update", "post", { ...post, status: "draft" });     // true
ability.can("update", "post", { ...post, status: "published" }); // false
```

The order of rules in the array does not matter.

## When the data doesn't fit

A condition can answer **unknown** — a wrong-typed field, a corrupt relation ([operators](./operators.md)):

| The condition answers | an `allow` | a `deny` |
|---|---|---|
| yes | grants | denies |
| unknown | grants nothing | **denies** |
| no | grants nothing | does not apply |

A `deny` steps aside only when its condition is decidably false for the row, so a value of the wrong type cannot slip past a prohibition.

A check without a row asks a different question — see [with a row or without](./ability.md#with-a-row-or-without).

## Why it works this way

- **Precedence is fixed, not configurable.** That is what lets the same rules compile to `allows AND NOT denies` in SQL with no solver, so the query returns exactly what `can()` allows.
- **`manage` is never asked.** It matches every action in a rule; a check that names it selects no rule and is refused.

## Source

[`check/rule.ts`](../packages/core/src/check/rule.ts) · [tests](../packages/core/tests/check/rule.test.ts)
