---
"@vetojs/core": minor
---

**`markLoaded` fills in the relations a serializer dropped.** Sources that leave empty values out — `jsonb_strip_nulls`, Go's `omitempty`, Jackson's `NON_NULL`, protobuf JSON — return a loaded but empty relation with no key, and a check that reads it throws as if it had never been loaded. Name the relations you loaded, written as the row would look with each of them empty:

```ts
const ready = markLoaded(post, { author: null, comments: [{ author: null }] });
```

A missing to-one becomes `null` and a missing list `[]`. Values that are there are kept, and a relation you do not name stays unloaded. The shape is checked against the row's type; `LoadedRelations<T>` names it.

A relation that is `undefined` reads as not loaded on every row, including one `markLoaded` returned.
