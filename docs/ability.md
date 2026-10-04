# Checking access — `buildAbility`

**[English](ability.md) · [Русский](ability.ru.md)**

`buildAbility(ac, rules)` turns a policy into the object you ask. Build one per request.

```ts
const ability = buildAbility(ac, policyFor(user));

ability.can("update", "post", post);       // may this actor update this row?
ability.authorize("update", "post", post); // the same, throwing ForbiddenError
```

| Method | Answers |
|---|---|
| `can(action, resource, row?)`, `cannot` | may the action happen |
| `authorize(action, resource, row?)` | the same, throwing `ForbiddenError` on a refusal |
| `canMutate(action, resource, row)` | may this row be written — [writes](./mutations.md) |
| `validatePayload(action, resource, row, data)` | may this data be written — [writes](./mutations.md) |
| `permittedFields(action, resource, row, fields)` | which of `fields` may be written |
| `where(action, resource)` | the condition for a query — [filtering](./where.md) |
| `validate(resource, data)` | does the data match the resource's schema |
| `rules` | the rules, plain JSON, for the client |

## With a row or without

With a row the answer is exact. Without one, `can` is optimistic — *could this be allowed for some row?* — which is what decides whether to render a "New post" button. It is true when an `allow` covers the action and no unconditional `deny` overrides it.

`authorize`, `canMutate` and a guarded call do not guess. Without a row they pass only when an `allow` with no `where` covers the action and no `deny` reads the row:

```ts
// allow("create", "post"), allow("update", "post", { where: { authorId: user.id } })
ability.can("update", "post");             // true — for some post
ability.authorize("create", "post");       // passes
ability.authorize("update", "post");       // throws — which post?
ability.authorize("update", "post", post); // exact
```

When the operation touches a row, pass it.

## Catching the refusal

```ts
try {
	ability.authorize("delete", "post", post);
} catch (error) {
	if (ForbiddenError.is(error)) {
		error.action;     // "delete"
		error.resource;   // "post"
		error.violations; // set when a payload was refused
	}
}
```

Use `ForbiddenError.is`, not `instanceof`: with two copies of `@vetojs/core` in one tree, `instanceof` answers `false` and a 403 becomes a 500.

## Recording decisions

`onDecision` receives every answer as data — what was asked, what was answered and the rule that settled it:

```ts
const ability = buildAbility(ac, policyFor(currentUser), {
	onDecision: (decision) => log.info({ actor: currentUser.id, ...decision }),
});
```

- It fires once per call of `can`, `cannot`, `authorize`, `canMutate` and `validatePayload`; not for `where`, `permittedFields` or `validate`.
- `rule` is the `deny` that fired or the `allow` that granted. It is absent when nothing matched — a question the policy says nothing about, worth an alert — and when a call without a row refused because the answer depended on one.
- A payload decision carries `violations` instead of `rule`. `{ field: "authorId", reason: "field not permitted" }` in an agent's log is an attempt to write someone else's field.
- `reason: "not a plain row"` marks a row the engine will not read: a class instance, a `Date`, an array.
- The row and the data are not in the report; close over them in the hook if you need them.
- A hook that throws stops the call, and your exception reaches the caller in place of the answer. Catch inside the hook when logging must not block a check.

## `withEnv` — the request's environment

With an [`env` declared](./define-abilities.md#the-requests-environment), `buildAbility` returns an `AbilityForEnv`, and its type offers nothing to ask until `withEnv` binds the environment of one request:

```ts
import { buildAbility, createRules, defineAbilities, shape, withEnv } from "@vetojs/core";

const ac = defineAbilities({
	env: shape<{ hour: number; mfa: boolean }>(),
	resources: { invoice: { schema: shape<{ id: string }>(), actions: ["read", "delete"] } },
});
const { allow, deny } = createRules(ac);

const policy = [
	allow("read", "invoice", { when: { hour: { gte: 9 } } }),
	allow("delete", "invoice"),
	deny("delete", "invoice", { when: { mfa: { ne: true } } }),
];

const ability = withEnv(buildAbility(ac, policy), { hour: 14, mfa: false });
ability.can("read", "invoice");   // true
ability.can("delete", "invoice"); // false — no MFA, the deny stands
```

Bind once per request: `can` and `where` on one binding read the same environment. Binding again to equal keys and values returns the same ability, so a literal written on every render rebuilds nothing. `withEnv` is a separate import, so an app without an environment does not ship it.

## `permittedFields` — for forms

```ts
ability.permittedFields("update", "post", post, ["title", "status", "views"]);
// → ["title", "status"]
```

You pass the candidate fields because a schema cannot be asked for its keys. With the row the answer is the one `validatePayload` gives for each field. With `undefined` it is optimistic, as `can` is: a field only the row could settle stays in the list, and `validatePayload` refuses it once the row is known.

## `validate` — shape, not permission

```ts
const result = ability.validate("post", input);
if (!result.ok) return badRequest(result.issues); // [{ message, path? }]
```

It runs the resource's [Standard Schema](./define-abilities.md#validating-data-with-a-real-schema). With `shape<T>()` it only refuses non-objects. An undeclared resource is refused.

## Why it works this way

- **An ability per request costs almost nothing.** It is closures over one actor's rules, so there is nothing to cache or share between users.
- **Checks are total.** A row that is not a plain object is refused and a wrong-typed field is unknown, so malformed input narrows access and never throws or grants.
- **A rule naming something you never declared matches nothing.** Such a rule can only arrive through [`parseRules`](./parse.md#names-are-not-checked), which checks shape, not names.

## Source

[`api/ability.ts`](../packages/core/src/api/ability.ts) · [`api/with-env.ts`](../packages/core/src/api/with-env.ts) · [tests](../packages/core/tests/api/ability.test.ts)
