---
"@vetojs/core": minor
---

**A symbol cannot name a field, and saying so is now a refusal rather than a silence.** `Object.entries` does not see symbol keys, so `where: { authorId: actor.id, [tag]: "x" }` used to compile to the first condition alone — the rule widened, quietly, to every row the dropped key would have excluded. Creating it now throws:

```
veto: where names Symbol(tag) — a rule outlives JSON and a symbol does not,
so the key would be dropped and the rule would widen. Name the field with a string.
```

`values` refuses one the same way.

**The types refuse it too, and refuse a numeric key with it.** A `where` key was checked against `WhereKeys & string` in one place and against the raw `WhereKeys` in another, so a shape declaring `{ [tag]: string }` or `{ 1: string }` let a rule name that key. Both are compile errors now, in either spelling:

```diff
-schema: shape<{ 1: string; title: string }>()
+schema: shape<{ "1": string; title: string }>()
```

A rule is JSON and a JSON key is a string. Spell a numeric field name as a string in the shape and it works as it always did at runtime, where `{ 1: "x" }` and `{ "1": "x" }` were never two different keys.
