# How a decision is made

**[English](rule-evaluation.md) · [Русский](rule-evaluation.ru.md)**

Given a list of rules and a question — *may this actor `update` this `post`?* — the engine returns one boolean. Two lines describe the whole algorithm:

> **An explicit `deny` always wins. Anything not explicitly allowed is denied.**

Everything else on this page is the precise meaning of those two lines.

## Which rules take part

A rule joins the decision when both hold:

1. **the resource matches** — `rule.resource === "post"`;
2. **the action matches** — the rule names it, includes it in a list, or says `"manage"` (which means every action on that resource).

A matching rule's `where` is then evaluated against the row. A rule with no `where` applies to every row.

## The decision

1. **Any applicable `deny` → denied.** No appeal, regardless of how many allows exist.
2. Otherwise **any applicable `allow` → allowed.**
3. Otherwise **denied** — the default.

```ts
const rules = [
	allow("update", "post"),
	deny("update", "post", { where: { status: "published" } }),
];

ability.can("update", "post", { ...post, status: "draft" });     // true
ability.can("update", "post", { ...post, status: "published" }); // false — deny wins
```

## When the data doesn't fit the rule

A `where` answers yes, no, or **unknown** — the last when the row and the condition are incoherent (a wrong-typed field, a corrupt relation, a malformed list; see [operators](./operators.md)). The decision treats unknown asymmetrically, and deliberately:

| verdict | an `allow` rule | a `deny` rule |
|---|---|---|
| yes | grants | denies |
| unknown | grants nothing | **denies** |
| no | grants nothing | doesn't apply |

Read the middle row again: a deny fires on unknown. If it didn't, sending a value of the wrong type would be enough to slip past a prohibition — the deny would evaluate to "doesn't match this row" and step aside. Both columns fail closed, so bad data can only ever shrink access.

A `deny` steps aside only when its condition is **decidably false** for this row.

## Why it works this way

- **Deny-override and default-deny are fixed, not configurable.** That is what lets the same rules compile to a SQL `WHERE` as a mechanical `OR(allows) AND NOT OR(denies)` — no solver, no normalisation, and the database returns exactly the rows `can()` would allow. Make the precedence configurable and that guarantee dies.
- **`"manage"` matches every action**, as a bare value or inside a list, for allow and deny alike. A question never names it: one that does selects no rule and is refused.
- **This layer requires a row.** It answers "may the actor act on *this* row". The question "should the button be visible at all", which has no row yet, is answered by `can(action, resource)` without a row — see [ability](./ability.md).
- **Missing relation data throws instead of denying quietly.** A `where` that reaches into a relation you didn't load raises `RelationNotLoadedError` — a bug in your query, surfaced rather than silently changing the answer.
- **Once an allow has matched, remaining allows are skipped.** Only denies can still change the outcome, so their conditions are the only ones left worth evaluating.

## Source

[`check/rule.ts`](../packages/core/src/check/rule.ts) · [tests](../packages/core/tests/check/rule.test.ts)
