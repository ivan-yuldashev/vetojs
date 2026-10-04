---
"@vetojs/core": major
---

**`permittedFields` takes the row.** The answer is the one `validatePayload` gives for each field of that row, so a field a `deny` takes away from this particular row drops out of the list. Pass `undefined` when the row is not at hand: the answer is then optimistic, as it is for `can`, and `validatePayload` refuses what the row turns out to forbid.

```diff
-ability.permittedFields("update", "post", ["title", "status"]);
+ability.permittedFields("update", "post", post, ["title", "status"]);
```
