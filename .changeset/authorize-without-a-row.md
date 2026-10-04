---
"@vetojs/core": major
---

**`authorize` without a row refuses what only a row could settle.** It passes when an `allow` with no `where` covers the action and no `deny` reads the row; an `allow` conditioned on rows, or a `deny` that could fire on one, now throws `ForbiddenError`. `can` and `cannot` without a row stay optimistic.

`canMutate` without a row answers the same way, so a permission conditioned on rows no longer grants a create. A guarded action with neither `load` nor `payload` is checked the same way too.

Such a refusal names no rule in `onDecision`: a condition speaks about a row, so without one no rule refused. A `deny` that fires is still named, one that fires on data it could not compare in the row it was given included.

Pass the row wherever the operation touches one:

```diff
-ability.authorize("update", "post");
+ability.authorize("update", "post", post);
```
