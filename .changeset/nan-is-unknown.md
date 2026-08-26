---
"@vetojs/core": minor
---

**`NaN` and an invalid `Date` answer an ordering as unknown, so a prohibition still fires.**

`deny("update", "txn", { where: { amount: { gt: 1000 } } })` used to stand aside for a row whose `amount` was `NaN`: the comparison answered a decidable "no", which reads as "the prohibition does not apply". So did `gte`, `lt` and `lte` — a value that cannot be ordered slipped past every limit, and `gt 1000` together with `lte 1000` cover the whole line, so nothing was left to catch it. An invalid `Date` behaved the same, and both arrive easily: `parseFloat` on dirty input, `Number(undefined)`, a `NUMERIC 'NaN'` column, `new Date(…)` on a malformed string.

The answer is now *unknown*, which is what the engine already answers for a comparison it cannot settle: an `allow` grants nothing and a `deny` fires. A field that is absent or `null` is unchanged — that is a decidable non-match, and it stays one.
