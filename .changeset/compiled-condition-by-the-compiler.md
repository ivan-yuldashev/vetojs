---
"@vetojs/core": patch
---

`createRules` no longer checks at runtime whether a `where` it is handed is a condition it compiled earlier. The types refuse one already: pass the shorthand you wrote, or send the whole rule through `parseRules`.

An operator left `undefined` is refused under the key it sits on — `values.status.eq is undefined` — where the message used to read `where.eq` whatever the rule key and the field.
