---
"@vetojs/core": minor
"@vetojs/react": minor
---

**A rule can depend on the request's environment.** Declare what it carries, write `when` on a rule, and bind the environment of one request with `withEnv`:

```ts
const ac = defineAbilities({
	env: shape<{ hour: number; mfa: boolean }>(),
	resources: { invoice: { schema: shape<Invoice>(), actions: ["read", "delete"] } },
});

const { allow, deny } = createRules(ac);
const policy = [
	allow("read", "invoice", { when: { hour: { gte: 9 } } }),
	allow("delete", "invoice"),
	deny("delete", "invoice", { when: { mfa: { ne: true } } }),
];

const ability = withEnv(buildAbility(ac, policy), { hour: 14, mfa: session.mfa });
```

An `allow` takes part only when its `when` holds; a `deny` stays unless its `when` fails. A key the environment lacks answers unknown, so a missing value never lifts a prohibition. `can` and `where()` on one binding read the same environment, and binding again to an environment with the same keys and values hands back the same ability.

With an `env` declared, `buildAbility` returns an `AbilityForEnv`, which answers nothing until `withEnv` binds it. Where no environment is bound — an app without `env` reading rules with `when` — an `allow` with `when` grants nothing and a `deny` with `when` stands. `parseRules` checks `when` as a condition with no relations.

`createGuard` takes `getEnv`, required when the declarations name an `env`. It receives the wrapped function’s arguments, runs alongside `getActor`, and every check of the call and `ctx.ability` read the environment it returns. `onDecision` gets the environment as its third argument.

With an `env` declared, `createVetoContext(ac, withEnv)` takes `withEnv`, and `AbilityProvider` takes `rules` together with the `env` to bind them to. A change of either rebinds, the rules set through `useSetRules` included, and `useCan` and `<Can>` re-render only when their answer flips. `withEnv` is passed in rather than imported, so an app without an environment does not carry it.

Code that never imports `withEnv` builds and checks as fast as before; the browser bundle on trusted rules grows by about 40 B gzip, and the React provider by about 90 B.
