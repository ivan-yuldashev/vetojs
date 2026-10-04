---
"@vetojs/core": patch
---

**`ability.rules` is no longer frozen at runtime.** The type has always refused to have it changed — `readonly CheckedRule[]` rejects `push`, index assignment and reassignment — and the engine reads a copy of its own, so nothing done to the array it hands back can move a verdict. The freeze added a `TypeError` on top of that, and only for the harmless half: appending to the array never changed an answer, while editing a rule object in place can, and a shallow freeze never stopped that.

A policy that changed is a new `buildAbility`, as it always was. If you were relying on the throw from JavaScript, the answer is the same call.
