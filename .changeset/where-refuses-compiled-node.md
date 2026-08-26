---
"@vetojs/core": patch
---

**`where` refuses a condition that was already compiled.**

Handing `otherRule.where` — or any `{ field, op, value }` node — to `allow` or `deny` now throws a `TypeError` that names what to pass instead: the shorthand the rule was written from, or the whole rule through `parseRules`. It used to compile into a condition over fields named `field`, `op` and `value`, which no row has.

To share one condition between two rules, keep the shorthand and pass it to both:

```ts
const mine = { authorId: user.id };

allow("read", "post", { where: mine });
allow("update", "post", { where: mine });
```
