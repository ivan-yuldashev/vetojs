# Checking access — `buildAbility`

**[English](ability.md) · [Русский](ability.ru.md)**

`buildAbility(ac, rules)` turns an array of rules into the object you actually call. Every method is bound to your resource schema, so the action, the resource and the row shape are all checked as you type.

```ts
const ability = buildAbility(ac, policyFor(user));

ability.can("update", "post", post);        // may this actor update this row?
ability.can("update", "post");              // could they update any post at all?
ability.authorize("update", "post", post);  // same, but throws instead of returning false
```

It holds no state and mutates nothing — `ability.rules` is the array of rules it was built from, ready to be serialised and sent to the client.

## What's on it

| Method | Answers |
|---|---|
| `can` / `cannot` | may this action happen — with a row, or without one |
| `authorize` | same as `can` with a row, but throws `ForbiddenError`; without one it does not guess |
| `canMutate` | may this row be written — see [mutations](./mutations.md) |
| `validatePayload` | may *this data* be written |
| `permittedFields` | which fields the UI should let them edit |
| `where` | the condition for a database query — see [where](./where.md) |
| `validate` | does incoming data match the resource's schema |
| `rules` | the underlying array, plain JSON |

## One decision, three ways to report it

Given a row, `can`, `cannot` and `authorize` all evaluate **the same thing**. They differ only in how the answer comes back, so you can pick the one that fits the call site:

```ts
if (ability.can("update", "post", post)) { … }                  // a boolean, to branch on
if (ability.cannot("update", "post", post)) return notFound();  // an early exit
ability.authorize("update", "post", post);                      // throws, at a boundary
```

`authorize` saves you writing `if (!can(…)) throw new ForbiddenError(action, resource)` and guarantees every refusal looks the same.

## The real distinction: with a row or without

That axis is separate from the three above, and it is the one that changes the question being asked.

**With a row** the answer is exact — conditions are evaluated against it.

**Without a row** the answer is optimistic: *could this be allowed for some row?* That is what UI gating needs, when you decide whether to render a button before anything exists to check. It is true when some `allow` covers the action and no blanket `deny` overrides it.

```ts
ability.can("create", "post");        // show the "New post" button?
ability.can("update", "post", post);  // enable Edit on this row?
```

`authorize` takes both forms too, but without a row it does not answer optimistically. It passes only when no row could change the answer: an `allow` with no `where` covers the action, and no `deny` reads the row. That is what a route handler guarding "may this user create posts at all" needs, and it is why the same call refuses an actor who may update only their own posts:

```ts
// allow("create", "post"), allow("update", "post", { where: { authorId: user.id } })
ability.authorize("create", "post");        // passes
ability.authorize("update", "post");        // throws — which post?
ability.authorize("update", "post", post);  // exact
```

> **`can` without a row answers a weaker question, and nothing stops you using it by mistake.** If the operation touches a specific row, pass that row: `can("update", "post")` is `true` for an actor who may update *some* post — but not this one.

## Catching the refusal

```ts
import { ForbiddenError } from "@vetojs/core";

try {
	ability.authorize("delete", "post", post);
} catch (error) {
	if (ForbiddenError.is(error)) {
		error.action;     // "delete"
		error.resource;   // "post"
		error.violations; // set only for payload failures
	}
}
```

Handy in a route handler or server action where a framework error boundary turns the throw into a 403.

Use `ForbiddenError.is` rather than `instanceof`. If two copies of `@vetojs/core` ever end up in one tree, the error has two class identities and `instanceof` answers `false` for a perfectly valid refusal — a 403 silently becomes a 500. The brand behind `is` is a registered symbol, so it survives that.

## Watching the decisions

Pass `onDecision` and every answer arrives as data — what was asked, what was
answered, and the rule that settled it:

```ts
const ability = buildAbility(ac, policyFor(currentUser), {
	onDecision: (decision) => {
		log.info({
			actor: currentUser.id,
			action: decision.action,
			resource: decision.resource,
			allowed: decision.allowed,
			rule: decision.rule,
		});
	},
});
```

The actor is not part of the report because it does not need to be: an ability
belongs to one actor, so the hook's own closure already has them.

`rule` is the `deny` that fired or the `allow` that granted, and it is absent
when nothing matched and the default denied — which is the case worth alerting
on, because it means a policy said nothing about a question someone asked.
It is absent too when a deciding call without a row refused because the answer
depended on one: a condition speaks about a row, so no rule refused. A `deny`
that fires on data it could not compare, in a row that was passed, is named:
the row was there, and the deny read it.

It fires for `can`, `cannot`, `authorize`, `canMutate` and `validatePayload`,
once per call. A payload decision carries no `rule`, because a refusal there is
settled field by field; it carries `violations` instead — the same list the call
returns. That is what tells an attempted substitution apart from an ordinary
refusal in a log: `{ field: "authorId", reason: "field not permitted" }` says
someone tried to write a field they do not own. An **empty** `violations` list is
still a refusal — the write was turned down whole, by a blanket `deny` or for want
of an `allow`, so no field was left to name. Not for `where`, `permittedFields` or `validate`: those ask what
a policy says, not whether an actor may act.

The verdict is settled before the hook runs, so nothing it does can change the
answer. A hook that **throws** is different: the call stops there and your
exception reaches the caller in place of the answer, so none of the calls above
hands back a grant it could not record. Catch inside your own hook when telemetry must not block a
check:

```ts
const ability = buildAbility(ac, policyFor(currentUser), {
	onDecision: (decision) => {
		try {
			log.info(decision);
		} catch (error) {
			console.warn("veto: decision hook failed", error);
		}
	},
});
```

Neither the row nor the data is in the report. Field names are; values are not,
because a decision log is not where they belong by default. Both are in scope
where you write the hook, so a log that needs them can close over them.

## `permittedFields` — for forms

```ts
ability.permittedFields("update", "post", post, ["title", "status", "views"]);
// → ["title", "status"]
```

You pass the field universe rather than getting it for free, because a schema can't be asked for its keys — `shape<T>()` is erased at runtime, and Standard Schema doesn't enumerate them either.

The row makes the answer exact — the one `validatePayload` gives for each field, so a field a `deny` takes away from this particular row drops out. Pass `undefined` when the row is not at hand and the answer is optimistic, as it is for `can`: a field the rules cannot settle without a row stays in the list, and `validatePayload` refuses it once the row is known.

This drives the UI. The server still enforces with `validatePayload`; a disabled input is a courtesy, not a control.

## `validate` — shape, not permission

```ts
const result = ability.validate("post", input);
if (!result.ok) return badRequest(result.issues);
// result.value is validated and narrowed
```

This is the other half of handling untrusted input: `validate` answers *is this even a valid post?*, `validatePayload` answers *is this actor allowed to write it?* Both, in that order, is the complete story.

Each issue carries the schema's own `message` and the `path` it blamed — `["authorId"]`, or `["meta", "views"]` when nested — so a log or a form knows which field to point at. `path` is absent when the schema blamed the value as a whole.

It runs the resource's schema, so it only does something real when you passed a Standard Schema (Zod, Valibot, ArkType) to `defineAbilities`. A phantom `shape<T>()` still rejects non-objects but can't check fields. Async schemas are not supported — a `validate` returning a promise throws, which rules out Yup: it implements the standard, but only asynchronously. See [swapping in a real schema](./define-abilities.md#swapping-typet-for-a-real-schema).

Unknown resources fail rather than pass through, as a gate should.

## Types are guidance; the engine is the guard

Methods take typed arguments so your editor autocompletes and typos don't compile. That typing expresses *intent* — it isn't what keeps you safe.

Safety comes from the engine being total: a non-object is denied, a wrong-typed field is "unknown" and fails closed both ways. So a row that doesn't match its declared shape can only ever cause *more* denial, never a crash and never a grant.

When data of unverified shape has to enter, use the gate for its kind rather than an `as unknown as` cast:

| Data | Gate |
|---|---|
| rule JSON from a database or network | [`parseRules(json, ac)`](./parse.md) |
| a row or payload of unverified shape | `ability.validate(resource, data)` |

## Rules your declarations don't mention

`buildAbility` doesn't throw, drop, or warn on them — by the time rules reach it they are trusted, and the checking already happened upstream: at compile time via `createRules`, or at runtime via `parseRules`. That's also why `buildAbility` only accepts checked rules — see [parse](./parse.md).

## Why it works this way

- **Plain data and closures, never a class.** Nothing to serialise around, nothing to mutate, safe to build per request in a server component.
- **`authorize` returns nothing.** It's a guard, not a transformer — the row you passed in is already typed.
- **`authorize` without a row refuses what only a row could settle.** It stands where an operation is about to happen, and "allowed for some row" is no reason to proceed there. `can` without a row stays optimistic, because a hidden button is a courtesy and the check happens on the server.
- **`canMutate` and `validatePayload` take a partial row**, because a pre-insert candidate has no database-generated `id` or `createdAt` yet, and demanding a complete row would force a cast at every create.
- **`ability.rules` is the wire format.** Send it to the client, hand it to `<AbilityProvider rules={…}>`, and the same rules drive the UI.

## Source

[`api/ability.ts`](../packages/core/src/api/ability.ts) · [tests](../packages/core/tests/api/ability.test.ts)
