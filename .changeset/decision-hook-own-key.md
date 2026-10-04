---
"@vetojs/core": patch
---

`buildAbility` reads `onDecision` only as an own property of its options, so a polluted `Object.prototype.onDecision` hears no decision.
