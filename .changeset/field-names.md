---
"@vetojs/core": major
---

**A rule names at least one field, each by a non-empty string.** The `Rule` type now says so: a hand-written `Rule` with `fields: []` no longer compiles, as `allow("update", { post: [] })` already did not. A field is a string key of the resource's shape other than `""` — a numeric or symbol key could never match a write, whose keys are strings. `parseRules` refuses an empty field name, as it refuses an empty action or resource name, and `permittedFields` takes string field names only.

A list built at runtime has to be shown non-empty before it becomes a rule:

```ts
const [first, ...rest] = editable;

if (first !== undefined) {
	rules.push(allow("update", { post: [first, ...rest] }));
}
```
