---
"@vetojs/core": major
"@vetojs/react": major
"@vetojs/drizzle": major
---

**`manage` is written in a rule, never asked.** `can`, `cannot`, `authorize` and every other question take an action the resource declares; `can("manage", "post")` no longer compiles, and neither does `<Can I="manage">`, `useCan("manage", …)`, a guarded action named `manage` or `schema.filter(ability, "manage", …)`. A question about `manage` that gets past the types is refused.

Asked, `manage` could only say whether some rule reads `manage`: `true` for an owner denied `delete`, `false` for someone granted every action one by one. Ask about the action you mean:

```diff
-ability.can("manage", "post");
+ability.can("update", "post");
```

`ActionFor` still includes `manage` and types what a rule names; `DeclaredAction` types what a question names.

**A rule names at least one action.** `allow([], "post")` and `deny([], "post")` no longer compile, nor does a `Rule` written with `action: []`, and `parseRules` refuses one — an empty list matched nothing, so such a `deny` protected nothing. `parseRules` also refuses an empty action or resource name.
