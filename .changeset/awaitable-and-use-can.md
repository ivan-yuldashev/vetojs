---
"@vetojs/core": major
"@vetojs/react": major
---

**`Awaitable` and `UseCan` are no longer exported.** `Awaitable` from `@vetojs/core/guard` was `T | Promise<T>`; write the union where you named it. The type of the `useCan` hook comes from the context that returns it:

```diff
-import type { UseCan } from "@vetojs/react";
-type CanHook = UseCan<typeof ac>;
+import type { VetoContext } from "@vetojs/react";
+type CanHook = VetoContext<typeof ac>["useCan"];
```
