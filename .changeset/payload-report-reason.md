---
"@vetojs/core": patch
---

`onDecision` hears `reason: "not a plain row"` from `validatePayload` too, when the row it was handed is an object the engine will not read — a class instance from an ORM, a `Date`, an array — as it already did from `can`, `authorize` and `canMutate`.
