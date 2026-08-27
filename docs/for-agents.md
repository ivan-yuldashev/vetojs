# For agents

**[English](for-agents.md) · [Русский](for-agents.ru.md)**

Everything needed to write correct Veto code, in one page. If you are generating code for someone else's project, read this first — the last section lists the mistakes that look plausible and are wrong.

## Install

```sh
npm install @vetojs/core          # the engine
npm install @vetojs/react         # optional: <Can>, useAbility, AbilityProvider
# the guard ships inside @vetojs/core, under @vetojs/core/guard
```

ESM only, Node 22+. `@vetojs/core` is a peer dependency of both bindings, so install it alongside them rather than relying on it being pulled in. `@vetojs/react` needs React 18+ as a peer as well.

## The whole flow

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";

// 1. Declare the resource schema once. Every type below is inferred from this.
const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published"; featured: boolean }>(),
			actions: ["read", "update", "publish"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

// 2. A policy is a pure function of the actor returning an array of rules.
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
	deny("update", "post", { payload: { fields: ["featured"] } }),
];

// 3. Build once per request, then check access.
const ability = buildAbility(ac, policyFor(currentUser));

ability.can("update", "post", post);
```

## API surface

### `@vetojs/core`

| Export | Signature | Purpose |
|---|---|---|
| `defineAbilities` | `({ resources }) => AC` | declares resources, actions, relations. `schema` is optional: leave it out for a resource with no rows — a screen, a report — and its shape is empty, so no row and no field comparison type-check |
| `shape<T>()` | `() => Schema<T>` | carries a row shape and checks nothing at runtime. Pass a Zod / Valibot / ArkType schema instead and `ability.validate` starts checking data — the shape is then inferred from it. **Not Yup**: its Standard Schema implementation is async, and an async schema throws |
| `createRules` | `(ac, { maxDepth? }?) => { allow, deny }` | typed rule factories |
| `buildAbility` | `(ac, rules) => AbilitySet` | turns a policy into the object you call |
| `parseRules` | `(json, vocabulary) => RuleParseResult` | validates untrusted rule JSON |
| `toVocabulary` | `(ac) => Vocabulary` | serializable names for storing a vocabulary |
| `markLoaded` | `(row, relation, value) => row` | states a relation is loaded |
| `"manage"` | action name | the wildcard: an `allow("manage", "post")` grants every action `post` declares, **including ones added later**. Write the list out instead — `allow([...ac.post.actions], "post")` — when the grant should be a snapshot |
| `ConditionOperator` | const object | `eq ne in nin gt gte lt lte contains exists has hasAny hasAll` |
| `ForbiddenError` | class | `.action`, `.resource`, `.violations?`; recognise it with `ForbiddenError.is(error)`, not `instanceof` |
| `RelationNotLoadedError` | class | `.relation` |
| `type<T>()` | `() => Schema<T>` | **deprecated**, the former name of `shape`, same function. Existing code keeps working; write `shape` in new code |

Methods on `ability`:

| Method | Returns | Use for |
|---|---|---|
| `can(action, resource, row?)` | `boolean` | branching. **Without a row the answer is optimistic** — true when some `allow` covers the action and no blanket `deny` overrides it — which is what a render decision needs before a row exists |
| `cannot(action, resource, row?)` | `boolean` | early exits |
| `authorize(action, resource, row?)` | `void`, throws `ForbiddenError` | server boundaries |
| `canMutate(action, resource, row)` | `boolean` | may this row be written |
| `validatePayload(action, resource, row, data)` | `{ ok: true, data } \| { ok: false, violations }` | may this data be written |
| `permittedFields(action, resource, fields)` | subset of `fields` | driving a form |
| `where(action, resource)` | `ConditionNode` | database filter |
| `validate(resource, data)` | `{ ok: true, value } \| { ok: false, issues }` | schema check; each issue is `{ message, path? }`, where `path` is the field the schema blamed |
| `rules` | `CheckedRules` | ship to the client |

### `@vetojs/react`

**In a server component, use the server entry — no provider, no context, nothing shipped to the browser:**

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>
```

For client components, call the factory once:

```ts
// src/veto.ts — call the factory once, import bindings from here
import { createVetoContext } from "@vetojs/react";
export const { AbilityProvider, useAbility, useCan, useSetRules, Can } =
	createVetoContext(ac);
```

```tsx
<AbilityProvider rules={ability.rules}>
	<Can I="update" a="post" this={post} fallback={<Disabled />}>
		<EditButton />
	</Can>
</AbilityProvider>
```

| Binding | Use it for |
|---|---|
| `Can` from `@vetojs/react/server` | gating a server component; takes `ability` directly |
| `<Can>` from the factory | gating a client component |
| `useCan(action, resource, row?)` | one verdict; re-renders only when that answer flips |
| `useAbility()` | anything beyond yes/no — `permittedFields`, `validate`, filtering a list |
| `useSetRules()` | switching actors on the client without re-rendering the page |

### `@vetojs/core/guard`

`createGuard({ ac, getActor, policy })` returns `withPermission(options, handler)`. It knows no framework — the same wrapper guards a server action, an HTTP handler and an agent's tool call. Declare `load` for the row and `payload` for what is being written; the handler runs only if both pass. `ctx.payload` is the validated copy, and `ctx.row` is a row rather than a maybe-row whenever `load` is declared. See [the guide](./guard.md).

A resource is a noun in the vocabulary, not a table, so an effect with nothing to fetch — sending mail, writing a file, calling a webhook, charging a card — is guarded the same way: `load` builds the row out of the arguments, deriving the fields the policy judges (`recipientDomain`, not the raw address). Skipping `load` there is a mistake: the row-less answer is optimistic, and a conditional `deny` refuses every call. See [guarding what an agent does](./agents.md).

## Writing conditions

Sibling keys are ANDed. A bare value means equals.

```ts
where: {
	status: "published",                  // eq
	views: { gte: 100 },                  // operator object
	title: { contains: "release" },       // strings only
	authorId: { in: ["u1", "u2"] },
	deletedAt: { exists: false },
	tags: { has: "release" },             // array field: has | hasAny | hasAll
	author: { role: "admin" },            // to-one relation
	comments: { none: { spam: true } },   // to-many: some | every | none
	or: [{ pinned: true }, { views: { gt: 1000 } }],
}
```

Operators are offered by field type, and the type system rejects the rest:

| Field | Operators |
|---|---|
| any scalar | `eq ne in nin exists`, plus a bare value for `eq` |
| `number`, `Date` | also `gt gte lt lte` |
| `string` | also `contains` |
| array of scalars | `has` (one member), `hasAny`, `hasAll`, `exists` — **not** `eq` or `in` |
| object, or array of objects | `exists` only |

The last two rows are the ones worth remembering: an array field takes `has` / `hasAny` / `hasAll`, and anything non-scalar can only be tested for presence, because comparing it by value is always unknown.

## Checking writes

Two questions, kept separate:

```ts
if (!ability.canMutate("update", "post", row)) throw new ForbiddenError("update", "post");

const result = ability.validatePayload("update", "post", row, data);
if (!result.ok) return badRequest(result.violations); // [{ field, reason }]

await db.update(posts).set(result.data).where(eq(posts.id, row.id));
```

Use `result.data`, not the raw input — it is the validated copy.

## Filtering in the database

```ts
const filter = ability.where("read", "post"); // a plain condition tree
```

The filter selects exactly the rows `can()` allows. Hand it to a database adapter; without an adapter, treat it as data — do not try to interpret it by hand.

With `@vetojs/drizzle`, compile and compose in one call — your own predicates go after the resource and narrow the result alongside the policy:

```ts
db.select().from(posts).where(schema.filter(ability, "read", "post", eq(posts.id, id)));
```

## Rules from outside

```ts
const result = parseRules(JSON.parse(raw), ac);
if (!result.ok) throw new Error(result.errors.join("\n"));
const ability = buildAbility(ac, result.rules);
```

`buildAbility` expects rules that passed a check — from `createRules` or from `parseRules` **with a vocabulary**. The type system enforces this wherever the value still has a type (see the note below about `any`).

## Emitting rules as JSON

When you are producing a policy rather than calling one — filling an admin UI, writing to a database — emit the stored form and let the gate check it. `toVocabulary(ac)` is the contract to write against: names only, no schemas, a few hundred bytes for a typical domain.

```ts
const proposed = [
	{
		effect: "allow",
		action: ["update", "publish"],
		resource: "post",
		where: { field: "authorId", op: "eq", value: "u1" },
		payload: {
			fields: ["status"],
			constraints: { field: "status", op: "in", value: ["draft"] },
		},
	},
];

const result = parseRules(proposed, toVocabulary(ac));
```

Two failure modes, and they want different responses:

| Result | Meaning | What to do |
|---|---|---|
| `ok: false` | the shape is wrong | fix and retry — every error carries a path, like `rules[0].where.op: unknown operator "regex"` |
| `ok: true` with a non-empty `unknown` | a name this deployment doesn't know | an `allow` was **quarantined** and grants nothing; a `deny` was **kept**, because a prohibition must keep protecting |

Reading only `result.rules` hides the second one: an invented action or resource makes an `allow` vanish without a word. Check `unknown` and report it.

**One shape per node.** A condition node names exactly one of `and` / `or` / `not` / `relation` / a field. Writing a field *and* an `and` in the same object is rejected — nothing merges them, and the reader would take one and drop the other.

## Mistakes to avoid

These compile-or-look fine and are wrong:

**A bare array on an array field.** It compares against that array, and a comparison against an array or an object is always **unknown** — it grants nothing and fires every `deny`. The type rejects it; reach for a membership operator instead.

```ts
where: { tags: ["a", "b"] }             // ✗ rejected by the type system
where: { tags: { in: ["a", "b"] } }     // ✗ `in` is for scalar fields, not array ones
where: { tags: { has: "release" } }     // ✓ this member is present
where: { tags: { hasAny: ["a", "b"] } } // ✓ at least one of them
where: { tags: { hasAll: ["a", "b"] } } // ✓ all of them
```

**Passing raw JSON to `buildAbility`.** Always go through `parseRules(json, ac)`.

```ts
buildAbility(ac, JSON.parse(raw));                       // ✗ compiles, but unchecked
buildAbility(ac, parseRules(JSON.parse(raw), ac).rules); // ✓
```

Note the comment: this one **does** compile, because `JSON.parse` returns `any`. The type system rejects a hand-written literal or a plain `Rule[]`, but nothing can catch a value that discarded its type. Do not rely on the compiler here.

**Using the row-less check as a row guard.** `can("update", "post")` and `authorize("update", "post")` answer *could this be allowed for some row* — they are for rendering decisions, not for guarding an operation on a specific row. If you have the row, pass it.

**Forgetting to load a relation the rule needs.** If a rule reads `post.author.role`, the author must be on the object, or `can()` throws `RelationNotLoadedError`. Load it in the query:

```ts
const post = await db.query.posts.findFirst({ with: { author: true } });
```

For hand-assembled objects use `markLoaded(post, "author", author)`; pass `null` for loaded-but-empty. Passing `undefined` throws — that is what "not loaded" means.

**Treating a hidden button as protection.** `<Can>` and `permittedFields` decide what to render. The request they hide can still be sent by hand, so the server needs its own check every time.

**Expecting a deny to step aside on bad data.** A `deny` fires on "unknown" — a wrong-typed value cannot slip past a prohibition. Malformed data can only ever narrow access, never widen it.

**Reaching for a config option to change precedence.** Deny always wins and everything not allowed is denied; neither is configurable. That is what lets the same rules compile to SQL.

**Catching the refusal with `instanceof`.** Write `ForbiddenError.is(error)`. Two copies of `@vetojs/core` in one dependency tree give the error two class identities, and `instanceof` then answers `false` for a perfectly valid refusal — turning a 403 into a 500, silently.

```ts
catch (error) {
	if (error instanceof ForbiddenError) { … }  // ✗ breaks on a duplicate copy
	if (ForbiddenError.is(error)) { … }         // ✓ matches on a registered symbol
}
```

## Framework placement

| Where | What to use |
|---|---|
| Server component / route handler | `buildAbility` per request, then `can` / `authorize` |
| Fetching a list | `ability.where(...)` in the query, never filter in JS after the fact |
| Mutation handler | `canMutate` + `validatePayload` |
| Client component | `<AbilityProvider rules={ability.rules}>` and `<Can>` / `useAbility` |
| Crossing server → client | send `ability.rules`; it is plain JSON |

## Full documentation

Per-concept pages, English and Russian, are indexed in [docs/README.md](./README.md).
