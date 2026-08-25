---
"@vetojs/core": minor
---

**A decision says when the row was something the engine will not read.**

`can()` reads plain data — an object whose prototype is `Object.prototype`, or none. Handed anything else, it answers the usual fail-closed `false`, which until now looked exactly like a refusal by policy. An ORM that returns entity class instances — TypeORM does — therefore produced checks that said no while the rule plainly matched.

The verdict is unchanged, and nothing new is thrown. What the decision hook receives now carries `reason: "not a plain row"` for that case, beside the `"no row"` the guard already reports:

```ts
buildAbility(ac, rules, {
	onDecision: (decision) => {
		if (decision.reason === "not a plain row") {
			logger.warn("pass a plain object: { ...entity }");
		}
	},
});
```

It covers `can`, `cannot`, `authorize` and `canMutate`. A row with no prototype at all is plain data and is read as before.
