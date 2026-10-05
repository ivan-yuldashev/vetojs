# For agents

**[English](for-agents.md) · [Русский](for-agents.ru.md)**

Everything needed to write correct veto code, on one page. The last section lists mistakes that look plausible and are wrong.

## Install

```sh
npm install @vetojs/core            # the engine; the guard is @vetojs/core/guard
npm install @vetojs/react           # optional: <Can>, useCan, useAbility
npm install @vetojs/drizzle         # optional: the policy as a SQL WHERE
```

ESM only, Node 22+. `@vetojs/core` is a peer dependency of the other two; React 18 or 19.

## The whole flow

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";

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

const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
	deny("update", { post: ["featured"] }),
];

const ability = buildAbility(ac, policyFor(currentUser)); // once per request
ability.can("update", "post", post);
```

## `@vetojs/core`

| Export | Signature | Purpose |
|---|---|---|
| `defineAbilities` | `({ resources, env? }) => AC` | resources, actions, relations; `env: shape<E>()` declares what a rule's `when` reads. `schema` is optional for a resource with no rows |
| `shape<T>()` | `() => Schema<T>` | a type only. A Zod / Valibot / ArkType schema instead makes `validate` check data; not Yup — it is async |
| `createRules` | `(ac) => { allow, deny }` | typed rule factories |
| `buildAbility` | `(ac, rules) => Ability` | the object you ask. With `env` declared it returns an `AbilityForEnv` with nothing to ask until bound |
| `withEnv` | `(ability, env) => Ability` | binds one request's environment; equal keys and values return the same ability |
| `parseRules` | `(json) => { ok: true, rules } \| { ok: false, errors }` | checks the shape of untrusted rule JSON |
| `markLoaded` | `(row, relation, value) => row` | `(row, relations) => row` | a copy with the relation set; `null` for loaded-but-empty. Given a shape like `{ author: null, comments: [] }`, fills the relations a serializer dropped |
| `ForbiddenError` | class | `.action`, `.resource`, `.violations?`; test with `ForbiddenError.is(error)` |
| `RelationNotLoadedError` | class | `.relation` |
| `ConditionOperator` | const object | the thirteen operators, for code that walks `where()` |

| `ability` method | Returns | Use for |
|---|---|---|
| `can(action, resource, row?)` | `boolean` | branching. Without a row: could it be allowed for some row |
| `cannot(action, resource, row?)` | `boolean` | early exits |
| `authorize(action, resource, row?)` | `void`, throws `ForbiddenError` | boundaries. Without a row it passes only an `allow` with no `where`, and no `deny` may read the row |
| `canMutate(action, resource, row)` | `boolean` | may this row be written; `undefined` for a create |
| `validatePayload(action, resource, row, data)` | `{ ok: true, data } \| { ok: false, violations }` | may this data be written |
| `permittedFields(action, resource, row, fields)` | subset of `fields` | a form |
| `where(action, resource)` | `ConditionNode` | a database filter |
| `validate(resource, data)` | `{ ok: true, value } \| { ok: false, issues }` | schema check |
| `rules` | `CheckedRules` | send to the client |

`"manage"` in a rule means every action of the resource, including ones added later; a check never names it. `buildAbility(ac, rules, { onDecision })` reports every decision — see [ability](./ability.md#recording-decisions).

## Writing conditions

```ts
where: {
	status: "published",                  // eq
	views: { gte: 100 },                  // number, Date: gt gte lt lte
	title: { contains: "release" },       // string
	authorId: { in: ["u1", "u2"] },
	deletedAt: { exists: false },
	tags: { has: "release" },             // array field: has | hasAny | hasAll
	spent: { lte: { ref: "limit" } },     // another field of the same row
	author: { role: "admin" },            // to-one relation
	comments: { none: { spam: true } },   // to-many: some | every | none
	or: [{ pinned: true }, { views: { gt: 1000 } }],
}
```

Sibling keys are ANDed, one operator per field. A wrong-typed value, `NaN`, an object compared by value or a field the row lacks answers **unknown**: an `allow` grants nothing, a `deny` fires. `null` is a value: against anything but `null` it is a plain no. `values` takes fields and `and` only; `when` takes fields of the environment and groups, no relations.

## Guarding an entry point

```ts
import { createGuard } from "@vetojs/core/guard";
import { ac, policyFor } from "./abilities";
import { getActor } from "./auth";

const withPermission = createGuard({ ac, getActor, policy: policyFor });

const publish = withPermission(
	{
		action: "publish",
		resource: "post",
		load: (args: { id: string; status: "draft" | "published" }) => loadPost(args.id),
		payload: (args: { id: string; status: "draft" | "published" }) => ({ status: args.status }),
	},
	async (ctx) => `published ${ctx.row.id}`,
);
```

The same wrapper guards a server action, an HTTP handler and a tool call; the wrapped function keeps its signature. `ctx.row` is what `load` returned (an empty `load` is refused), `ctx.payload` the validated data. With `env` declared, `createGuard` also takes `getEnv(...args)`. For a tool with no table — mail, a payment — `load` builds the row from the arguments; without a row an `allow` with a `where` grants nothing. A refusal throws `ForbiddenError`; put `error.violations` into the tool's result so the model can fix its arguments. See [agents](./agents.md).

## `@vetojs/react`

```ts
// src/authz.ts — call the factory once, import from here
import { createVetoContext } from "@vetojs/react";
import { ac } from "./abilities";

export const { AbilityProvider, useAbility, useCan, useSetRules, Can } = createVetoContext(ac);
```

```tsx
<AbilityProvider rules={ability.rules}>
	<Can I="update" a="post" this={post} fallback={<Disabled />}>
		<EditButton />
	</Can>
</AbilityProvider>
```

| Binding | Use for |
|---|---|
| `Can` from `@vetojs/react/server` | a server component; takes `ability`, ships nothing to the browser |
| `<Can>` from the factory | a client component |
| `useCan(action, resource, row?)` | one verdict, re-rendering only when it flips |
| `useAbility()` | `permittedFields`, filtering a list, several checks |
| `useSetRules()` | switching actors without re-rendering the page |

With `env` declared: `createVetoContext(ac, withEnv)`, and the provider takes `env` beside `rules`.

## Filtering in the database

```ts
const rows = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, id)));
```

`schema` comes from `defineTables(ac, { post: posts, … })` in `@vetojs/drizzle`. The filter selects exactly the rows `can()` allows; extra predicates only narrow it. Without an adapter, treat `ability.where()` as data.

## Emitting rules as JSON

When you produce a policy rather than call one — for an admin UI or a database — emit the stored form and check it:

```ts
const proposed = [
	{
		effect: "allow",
		action: ["update", "publish"],
		resource: "post",
		where: { field: "authorId", op: "eq", value: "u1" },
		fields: ["status"],
		values: { field: "status", op: "in", value: ["draft"] },
	},
];

const result = parseRules(proposed);
```

`ok: false` lists errors with paths, like `rules[0].where.op: unknown operator "regex"`. Names are not checked: an invented action or resource passes and then matches nothing, an invented relation throws on the first check. Take names from the declarations. A node names exactly one of a field, `and`, `or`, `not`, `relation`.

## Mistakes to avoid

**A bare array on an array field.**

```ts
where: { tags: ["a", "b"] }             // ✗ does not type-check
where: { tags: { in: ["a", "b"] } }     // ✗ `in` is for scalar fields
where: { tags: { hasAny: ["a", "b"] } } // ✓
```

**Raw JSON into `buildAbility`.** `buildAbility(ac, JSON.parse(raw))` compiles — `JSON.parse` returns `any` — and skips the check. Go through `parseRules`, then pass `result.rules` when `result.ok`.

**The row-less check as a row guard.** `can("update", "post")` is true if *some* post may be updated. Pass the row whenever the operation touches one.

**A relation the rule reads, not loaded.** `can()` throws `RelationNotLoadedError`. Load it — `with: { author: true }` — and convert ORM class instances with `structuredClone`.

**Validating shape with the guard.** It checks permissions, not schemas; validate arguments separately.

**A hidden button as protection.** The server checks every action.

**`instanceof ForbiddenError`.** Two copies of the package break it; use `ForbiddenError.is(error)`.

**Looking for an option to change precedence.** A `deny` always wins and everything not allowed is denied; that is what makes the SQL filter exact.

## Full documentation

Per-concept pages, English and Russian: [docs/README.md](./README.md).
