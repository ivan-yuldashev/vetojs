---
"@vetojs/core": patch
---

`parseRules` refuses a hole in the rule list or in an `and` / `or` — `[ , rule]` — and reports it at its index, as it does for any other entry that is not a rule or a condition. Such a list used to pass, and `buildAbility` then threw a `TypeError` on the first check.
