---
"@vetojs/core": patch
---

**`parseRules` judges a rule by the keys it carries, not by what it inherits.** Under a polluted `Object.prototype`, a rule was accepted on keys it did not own: `{}` passed as a whole rule when `effect`, `action` and `resource` sat on the prototype, a condition of `{ value: "…" }` passed as a field test, and a relation passed without stating its cardinality. Every key a rule or a condition is judged by — `effect`, `action`, `resource`, `field`, `op`, `type`, `match` — is now read off the object itself, as `value` and `where` already were.

**A condition naming no shape says that, instead of being read as a field.** `where: {}` used to report three things a field condition lacks; it now names what the node could have carried:

```diff
-rules[0].where.field: expected a string
-rules[0].where.op: unknown operator undefined
-rules[0].where.value: missing
+rules[0].where: a condition names none of "and" | "or" | "not" | "relation" | "field" — a node carries exactly one shape
```
