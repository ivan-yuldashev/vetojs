---
"@vetojs/core": minor
---

**`parseRules` refuses a comparison against a value its operator cannot compare.** `contains` takes a string, and `gt`, `gte`, `lt` and `lte` take a number or a string. Anything else — `null`, an object, a boolean, a list — is reported with its path and the rule is quarantined, as a non-array for `in` or a non-boolean for `exists` already is. Correct such a rule where it is stored.
