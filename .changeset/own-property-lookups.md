---
"@vetojs/core": minor
"@vetojs/drizzle": minor
---

**A resource, relation or field named after something every object inherits is looked up as an own property.**

`constructor`, `toString`, `valueOf`, `__proto__` and their kin are found on any object literal, so a rule naming one of them as its resource or relation used to reach a function through the prototype chain instead of missing:

- `parseRules` threw a `TypeError` instead of returning a result, which is the one thing it promises never to do — and the throw was controlled entirely by the contents of the rules it was handed.
- `ability.validate("constructor", data)` answered `{ ok: true }` for any object, where an undeclared resource must be refused.
- `@vetojs/drizzle` handed `Object.prototype.toString` to the query builder as though it were a column, instead of refusing the field.

Every lookup by a string key now checks `Object.hasOwn` first. A resource, relation or column genuinely called `constructor` still resolves — it is a declaration like any other.
