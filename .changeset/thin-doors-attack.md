---
"@vetojs/core": major
---

**`parseRules` checks the shape, and nothing else.** The second argument is gone, and with it `toVocabulary`, the `Vocabulary` type, the `unknown` report and `UnknownRule`. What a resource, an action or a relation is called is answered by the compiler where rules are written, and by generating them from the same declarations where they arrive from outside — a check after the fact reports drift, generation prevents it. Rules and the build reading them have to come from the same generation.

`parseRules(json)` now returns checked rules on its own, so the call `buildAbility` accepts is one argument shorter:

```diff
-const result = parseRules(JSON.parse(raw), toVocabulary(ac));
+const result = parseRules(JSON.parse(raw));
```

Reading `result.unknown` no longer compiles; delete the branch. A rule naming something this build lacks is no longer dropped: an unknown resource or action simply matches nothing, and an unknown relation throws `RelationNotLoadedError` on the check that reaches it.

**A condition that says nothing does not compile.** `where: {}`, `{ and: [] }`, `{ or: [] }`, an empty node nested inside a group, an empty negation or relation, `values: {}` and an empty field list are type errors in `allow` and `deny`, and `parseRules` rejects the same shapes arriving as JSON:

```diff
-allow("read", "post", { where: {} });
+allow("read", "post");
```

`where: {}` is refused with `Property '"veto: a condition has to name at least one field, relation or group"' is missing in type '{}'`.

Write the condition, or leave the key out. A rule carrying an empty one covered every row where it meant to cover some, and a `deny` naming no field protected nothing.
