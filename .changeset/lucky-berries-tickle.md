---
"@vetojs/core": minor
---

**The checked-rule mark cannot be written by hand.** `CheckedRule` carried `"~veto.checked": true`, and `true` is something anyone can type — a literal spelling that key compiled straight into `buildAbility`, past the gate the mark exists to hold. The value is now a symbol this module does not export, so the mark cannot be spelled at all:

```diff
 buildAbility(ac, [
-  { effect: "allow", action: "read", resource: "post", "~veto.checked": true },
 ]);
```

The message when a rule is not checked is the one it always was — `Property '"~veto.checked"' is missing` — and reaching past the gate on purpose is what it always was too: a visible `as CheckedRules`. Nothing is written at runtime; the mark is still phantom.
