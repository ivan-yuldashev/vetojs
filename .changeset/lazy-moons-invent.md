---
"@vetojs/core": major
---

**Fields move to the resource, and a rule carries them itself.** The `payload` container is gone: a rule names the resource, or the resource with the fields it covers, and the two conditions sit together in the options.

```diff
-allow("update", "post", {
-  where: { authorId: user.id },
-  payload: {
-    fields: ["title", "status"],
-    constraints: { status: { in: ["draft"] } },
-  },
-});
+allow("update", { post: ["title", "status"] }, {
+  where:  { authorId: user.id },
+  values: { status: { in: ["draft"] } },
+});

-deny("update", "post", { payload: { fields: ["featured"] } });
+deny("update", { post: ["featured"] });
```

The resource alone still means every field, so `allow("read", "post", { where })` is unchanged.

**Rules stored as JSON change shape.** `payload.fields` becomes `fields` and `payload.constraints` becomes `values`, both on the rule:

```diff
 {
   "effect": "allow", "action": "update", "resource": "post",
   "where": { "field": "authorId", "op": "eq", "value": "u1" },
-  "payload": {
-    "fields": ["status"],
-    "constraints": { "field": "status", "op": "in", "value": ["draft"] }
-  }
+  "fields": ["status"],
+  "values": { "field": "status", "op": "in", "value": ["draft"] }
 }
```

`parseRules` refuses a rule that still carries `payload` rather than reading past it, so a stored policy from an older build fails loudly instead of losing what its payload said.

**`RulePayload` is gone.** `Rule` carries `fields` and `values` directly.

**More is settled by the compiler.** The target ties the action, the resource and the fields together: an action the resource does not declare, a field it does not have, an empty field list, and two resources in one rule are all type errors. A permission's `values` stand on the fields it names — a value on a field outside the target could never be reached — while a prohibition's `values` and `fields` subtract independently, so it may name either or both.

`validatePayload`, `PayloadResult` and the guard's `payload` option are unchanged: they are about the data being written, not about what a rule says.
