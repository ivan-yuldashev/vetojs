---
"@vetojs/core": minor
---

**A payload naming `__proto__`, `constructor` or `prototype` is refused, and no rule can open it.**

When no `allow` listed `payload.fields`, every key was permitted — including the three that `JSON.parse` happily creates as own properties. They travelled through `validatePayload` into `result.data`, which is the object that goes on to `db.update().set(...)`, `Object.assign(row, data)` or a recursive merge. That is the boundary where a sanitiser is expected to reject them.

They are now reported as `field not permitted` like any other key a policy does not open, and listing one in `payload.fields` grants nothing — so a rule arriving from a database still only ever narrows access. A resource with a column genuinely called `constructor` writes it outside the payload path.

`result.data` is unchanged in every other way: the same plain object, carrying the same validated keys.
