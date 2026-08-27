---
"@vetojs/core": minor
---

**A resource whose columns are named `field`, `op` and `value` can be written with shorthand.**

`where` refused a condition that was already compiled by recognising its shape, so a policy over a table shaped like veto's own condition AST — a rules table, an audit log — could not name all three columns at once without being mistaken for a rule someone reused by accident.

The refusal now works by identity: `where` recognises the conditions it built itself, whatever they look like. Reusing another rule's `where` still throws and still says what to pass instead; a relation node is still recognised by shape, because nothing else takes that form.

```ts
allow("read", "rule", { where: { field: "authorId", op: "eq", value: "u1" } });
```
