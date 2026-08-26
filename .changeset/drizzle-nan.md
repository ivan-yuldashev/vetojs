---
"@vetojs/drizzle": minor
---

**A `NaN` in a `numeric` or floating-point column answers the way the engine answers it.**

Postgres orders `NaN` above every number: `'NaN'::numeric > 1000` is true, `< 1000` is false, and `'NaN' = 'NaN'` is true. The engine answers an ordering against `NaN` as unknown, so the filter and `can()` disagreed about such a row on every bound — under an `allow` the query returned it while `can()` refused it, and under a `deny` the other way round.

An ordering on a column that can hold `NaN` now compiles to `case when <column> = 'NaN' then null else <comparison> end`, which is unknown for that row and the plain comparison for every other. Columns that cannot hold one — `integer`, `bigint`, `text`, `timestamp` — compile exactly as before, with no extra test in the query.

A rule carrying `NaN` or an invalid `Date` as its value is handled the same way: unknown for an ordering, and no match for `eq`, `in` or array membership, which is what the engine answers.
