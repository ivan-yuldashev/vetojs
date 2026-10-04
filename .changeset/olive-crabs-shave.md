---
"@vetojs/core": major
---

**`createRules` takes the declarations alone.** The `maxDepth` option is gone: `and`, `or`, `not` and relations nest as deep as you write them.

```diff
-const { allow, deny } = createRules(ac, { maxDepth: 5 });
+const { allow, deny } = createRules(ac);
```

**A relation in `where` refuses a value that is not a condition.** `{ status: "draft", comments: 5 }` used to compile to a condition no row meets, so an `allow` granted nothing and a `deny` never fired; it now throws. Only reachable from JavaScript or through a cast — the types have always said otherwise.
