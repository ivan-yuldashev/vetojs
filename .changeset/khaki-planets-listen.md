---
"@vetojs/core": patch
"@vetojs/react": patch
---

**The row is called a row everywhere.** The same value was named `instance` in `can`, `cannot`, `authorize` and `markLoaded` and `row` in `canMutate` and `validatePayload`, sometimes in one paragraph. It is `row` now — in parameter names across both packages, `useCan` and both `<Can>` included, in the documentation, and in the message `RelationNotLoadedError` carries:

```diff
-Relation "author" is referenced by a condition but is not loaded on the instance.
+Relation "author" is referenced by a condition but is not loaded on the row.
```

An alert matching that string needs the new wording. Nothing else changes: parameter names are not part of a call, and no behaviour moved.
