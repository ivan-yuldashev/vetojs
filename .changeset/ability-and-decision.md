---
"@vetojs/core": major
---

**`AbilitySet` is now `Ability`, and `DecisionReport` is now `Decision`.** Only the type names change:

```diff
-import type { AbilitySet, DecisionReport } from "@vetojs/core";
+import type { Ability, Decision } from "@vetojs/core";
```

**A target's field list may be read-only**, so a target written once with `as const` can be reused across rules: `allow("update", titleOnly)` where `const titleOnly = { post: ["title"] } as const`. `Rule["fields"]` is typed `readonly` to match.
