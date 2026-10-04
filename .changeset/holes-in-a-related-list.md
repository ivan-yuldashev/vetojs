---
"@vetojs/core": patch
---

A to-many relation whose list has holes — `[ , comment]` — reads as corrupt data, the same as a list holding `undefined`: an `allow` grants nothing and a `deny` fires. The check no longer throws a `TypeError` on it.
