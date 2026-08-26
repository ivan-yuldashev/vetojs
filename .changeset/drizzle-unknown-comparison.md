---
"@vetojs/drizzle": minor
---

**A comparison the engine cannot decide now compiles to SQL unknown, not to `false`.**

`can()` answers an ordering comparison between values of different kinds — `views > "100"`, `publishedAt > "2026-01-01"`, anything ordered on a boolean column — as unknown, which makes a `deny` fire. The filter compiled that same comparison to `false`, and a policy of `allow AND NOT (deny)` turned it into `NOT false` — every row of the table. `contains` against a non-text column had the same shape.

Such a comparison now compiles to `case when <column> is null then false else null end`: unknown where the row has a value, and the decidable `false` where it is NULL, exactly as the engine answers it. Under an `allow` the row is not selected; under a `deny` it is not selected either. The identity `ability.where()` promises — the query returns the rows `can()` allows — holds for both.

Ordering a column whose type the adapter cannot check, such as a `customType`, still compiles to a comparison; a value that column cannot encode fails at the query, loudly, rather than widening it.
