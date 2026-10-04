---
"@vetojs/core": minor
"@vetojs/drizzle": minor
---

**A condition can compare two fields of the same row.** Write `{ ref }` in place of a value under `eq`, `ne`, `gt`, `gte`, `lt` or `lte`:

```ts
allow("update", "invoice", { where: { spent: { lte: { ref: "limit" } } } });
```

It compiles to `{ "field": "spent", "op": "lte", "ref": "limit" }`. The types offer only fields of the same row whose type matches; inside a relation both fields are the related row's. When either side is missing, `null` or `NaN`, the answer is unknown — an `allow` grants nothing and a `deny` stands — which is how SQL answers `spent <= limit` with a `NULL` on either side, so `can()` and `where()` agree.

`parseRules` accepts `ref` only in `where`, only under those six operators, and only in place of a value. `@vetojs/drizzle` translates it into a comparison of the two columns.

The browser bundle that parses rules grows by about 170 B gzip, the bundle on trusted rules by about 30 B.
