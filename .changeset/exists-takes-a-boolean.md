---
"@vetojs/core": minor
"@vetojs/drizzle": minor
---

**`exists` takes a boolean, and a rule carrying anything else is refused.**

The value was read as `Boolean(value)`, so `"false"`, `"0"`, `[]` and `{}` — all of them ordinary JSON — meant `exists: true`. A rule written as "this field must be absent" granted access to rows where the field is present: the inverse of what its author wrote.

`parseRules` now reports `expected a boolean for "exists"` and quarantines such a rule, the same way it already refuses a non-array for `in`. A rule that reaches the engine some other way answers *unknown* rather than guessing, so an `allow` grants nothing and a `deny` fires; `@vetojs/drizzle` compiles the same rule to unknown, so the query returns what `can()` allows.

`exists: true` and `exists: false` are unchanged, and still ask about presence rather than truthiness: `0`, `false` and `""` are values a row holds.
