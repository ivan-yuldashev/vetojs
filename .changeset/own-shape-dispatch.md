---
"@vetojs/core": minor
"@vetojs/drizzle": minor
---

**A condition's shape is read from its own keys, so a polluted prototype cannot reshape it.**

The engine decided what a condition node was with the `in` operator, which walks the prototype chain. In a process where something else had already achieved prototype pollution — a vulnerable `merge`, `set` or query parser anywhere in the dependency tree — a single `Object.prototype.and = []` made every condition read as an empty `and`, which is the engine's own "everything". Every rule became unconditional. `Object.prototype.not = {}` sent the compiler into unbounded recursion instead, and `Object.prototype.relation` threw out of the middle of a check.

Every place that asks what shape a node has — the compiler, the relation walk, the trust gate, the payload constraints, and the SQL adapter — now asks `Object.hasOwn`. So does the check for the vacuous `{ and: [] }` marker, which pollution could otherwise forge onto a sound rule and drop its condition.

A node that carries no shape the engine knows now answers *unknown* rather than being read as a field condition: an `allow` grants nothing, a `deny` fires, and the adapter refuses to build a query from it.
