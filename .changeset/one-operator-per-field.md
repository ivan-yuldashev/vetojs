---
"@vetojs/core": minor
---

**A field naming two operators at once is refused, with the `and` that means it.**

`{ age: { gte: 18, lte: 65 } }` reads like a range and compiles like one nowhere: the shorthand takes one operator per object, so a second key dropped the whole thing into an equality against `{ gte: 18, lte: 65 }`. No row equals that object, so the rule granted nothing — silently, and TypeScript let it through, because excess-property checking against a union of single-operator objects accepts a key that any member declares.

It now throws, naming both keys and the shape that expresses the range:

```
veto: "gte" and "lte" name one field at once — a condition takes one operator,
so write and: [{ field: { gte: … } }, { field: { lte: … } }].
```

A value that merely looks like one is untouched: a field compared to `{ theme: "dark" }`, or to an object where only some keys read as operator names, compiles to the equality it always did.
