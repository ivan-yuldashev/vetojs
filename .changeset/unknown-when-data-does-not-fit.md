---
"@vetojs/core": minor
"@vetojs/drizzle": minor
---

**Data that does not fit a condition answers unknown under every operator.** An `allow` grants nothing on it and a `deny` fires:

- a field missing from the row, or `undefined`, `exists` included — load the fields your rules read;
- a value of another type (`"5"` against `5`, `"true"` against `true`), `NaN` or an invalid `Date`, under `eq`, `ne`, `in` and `nin` as under `gt` and the rest;
- an array element or a list member of another type, when no other one matches.

`null` is a value: `eq null` holds only for `null`, and a `null` field is a plain no against anything else.

`gt`, `gte`, `lt` and `lte` compare numbers, `bigint` and dates. On two strings they answer unknown, in `ref` too, and `parseRules` refuses a string for them, as the types of `createRules` already did. Drizzle returns `numeric`, `date` and `timestamp` columns as strings by default; to order them, read them in `mode: "number"` or `mode: "date"`.

`createRules` throws, and `parseRules` refuses, on `NaN`, ±`Infinity` and an invalid `Date` in `where`, `values` and `when`.

`toDrizzle` and `filter` answer the same way as `can()`. A rule that does not fit its column — `has` on a scalar column, a string on an array column — selects what `can()` allows. A value Postgres would reject or read by its own rules — a word for a `numeric`, `date` or `timestamp` column read as a string, a number or a `bigint` past an integer column's range, a number past `Number.MAX_SAFE_INTEGER` that would reach Postgres rounded — throws while the query is built.
