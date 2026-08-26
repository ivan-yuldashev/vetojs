---
"@vetojs/core": minor
---

**A `deny` whose payload constraint says nothing stays a prohibition on the row.**

`payload.constraints` that the shorthand could not read — `or`, `not`, `relation`, a string, `null` — compiled to an empty condition, and an empty condition still marked the rule as scoped to a payload. A rule scoped that way is skipped by row checks, left out of `ability.where()`, invisible to the guard, and vetoes no field: an attempt to narrow a prohibition by value turned it into silence.

The shorthand now refuses what it cannot read, naming what payload constraints take — a field condition or `and`, which is what `parseRules` has always required. And a constraint that compiles to nothing no longer scopes a rule, whether it was written here or arrived as `{ "and": [] }` from a database, so the `deny` keeps prohibiting the row.

A constraint that does name a value is unchanged: the row stays readable and only the value it names is refused.
