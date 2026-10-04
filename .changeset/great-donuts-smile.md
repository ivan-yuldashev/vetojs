---
"@vetojs/core": major
---

**`type` is gone; the shape declaration is `shape`.** It was deprecated as an alias and the two were the same function, so the change is the name:

```diff
-import { defineAbilities, type } from "@vetojs/core";
-schema: type<Post>()
+import { defineAbilities, shape } from "@vetojs/core";
+schema: shape<Post>()
```

The old name collided with the TypeScript `type` modifier, so an import line carrying both read like a typo and sorters ordered it differently between runs.

**Every message the Drizzle adapter throws now begins `veto:`, as the engine's always did.** One string finds them all in a log:

```diff
-@vetojs/drizzle: column "authorId" does not exist in posts.
+veto: column "authorId" does not exist in posts.
```
