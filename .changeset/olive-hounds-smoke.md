---
"@vetojs/core": major
---

**`validatePayload` takes the whole row, or `undefined` when there is none.** It took `Partial<ShapeOf<AC, R>>` for both the row and the data — one type, two adjacent parameters — so handing them over in the other order compiled, and the answer flipped:

```ts
// policy: edit `title` only on your own posts
ability.validatePayload("update", "post", foreignRow, patch);  // { ok: false }
ability.validatePayload("update", "post", patch, foreignRow);  // { ok: true }  ← compiled
```

The row condition was judged by the payload, which the caller supplies, and the row's contents were approved as the write. The two now have different types, and the swap does not compile.

```diff
-ability.validatePayload("create", "post", {}, data);
+ability.validatePayload("create", "post", undefined, data);
```

`undefined` is how `can` and `canMutate` already say "no row", and it replaces `{}` as the create spelling. Behaviour is unchanged: the field and value levels answer, while an `allow` conditioned on rows cannot be shown to apply and grants nothing.

**A partially filled candidate is no longer accepted as the row.** Passing the record you are about to insert made row conditions judge data the caller assembled — the same confusion the swap exploited, and the opposite of what the documentation promises: that row conditions are not evaluated against something that does not exist yet. Pass `undefined`; the levels that can answer still do.
