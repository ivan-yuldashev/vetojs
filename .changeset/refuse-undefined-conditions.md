---
"@vetojs/core": minor
---

**A condition whose value is `undefined` is refused instead of dropped.**

`allow("read", "post", { where: { authorId: user.id } })` with an `undefined` id used to compile to a rule with no `where` at all — an unconditional grant on the whole resource, both for `can()` and for the `ability.where()` handed to the database. A rule with two conditions lost one and widened. It now throws a `TypeError` naming the key, at the moment the policy is written rather than on the next request:

```
veto: where.authorId is undefined — dropping it would widen the rule to every row.
Pass a value, or build the shorthand without the key.
```

The same refusal covers an `undefined` inside an operator (`{ eq: undefined }`), under `and`, `or` and `not`, inside a relation, as a relation quantifier, and in `payload.constraints`. A shorthand that describes no condition at all — a to-many relation with no quantifier — is refused for the same reason. `parseRules` rejects a compiled rule whose `value` is `undefined`.

What still compiles: `where: {}` and a rule written without a `where` (both unconditional on purpose), `null`, `false`, `0`, `""`, `{ exists: false }`, and the vacuous `{ and: [] }` and `{ or: [] }`.

Only `exactOptionalPropertyTypes: true` made TypeScript catch this before; the refusal does not depend on the compiler options of the project using it.
