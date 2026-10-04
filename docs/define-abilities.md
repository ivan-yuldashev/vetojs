# Declaring resources — `defineAbilities`

**[English](define-abilities.md) · [Русский](define-abilities.ru.md)**

One declaration says what resources exist, what can be done to them and how they relate. Every type downstream — resource names, actions, row shapes — is inferred from it.

```ts
import { defineAbilities, shape } from "@vetojs/core";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "create", "update", "delete", "publish"],
			relations: {
				blog: { resource: "blog", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		blog: { schema: shape<Blog>(), actions: ["read", "update"] },
		comment: { schema: shape<Comment>(), actions: ["read", "create", "delete"] },
	},
});
```

| Field | Meaning |
|---|---|
| `schema` | the row's shape. `shape<T>()` carries a type and checks nothing; a [Standard Schema](#validating-data-with-a-real-schema) also validates. Optional |
| `actions` | what can be done to the resource |
| `relations` | links to declared resources: `{ resource, kind: "one" \| "many" }` |

At runtime `defineAbilities` returns `resources` unchanged. Its value is the type:

```ts
type AC = typeof ac;

ResourceName<AC>;           // "post" | "blog" | "comment"
ActionFor<AC, "post">;      // the declared actions and "manage" — what a rule names
DeclaredAction<AC, "post">; // the declared actions — what a check names
ShapeOf<AC, "post">;        // Post
```

## The request's environment

Some decisions depend on the request rather than the row: the hour, the caller's IP, whether the session passed MFA, whether an agent is acting. Declare what a request carries with `env`, beside `resources`:

```ts
import { defineAbilities, shape } from "@vetojs/core";

const ac = defineAbilities({
	env: shape<{ hour: number; mfa: boolean }>(),
	resources: {
		invoice: { schema: shape<{ id: string; total: number }>(), actions: ["read", "delete"] },
	},
});
```

A rule reads those keys in its [`when`](./create-rules.md#what-a-rule-can-say), and [`withEnv`](./ability.md#withenv--the-requests-environment) binds the values of one request. Without `env`, no rule can be written with a `when`.

## A resource with no rows

A screen, a report, a background job — something a policy decides about, with no record behind it. Leave `schema` out:

```ts
const ac = defineAbilities({ resources: { report: { actions: ["view", "export"] } } });
const { allow } = createRules(ac);
const ability = buildAbility(ac, []);

ability.can("view", "report", { id: "r1" });        // ✗ there is no row to pass
allow("view", "report", { where: { id: "r1" } });   // ✗ and no field to compare
```

`can("view", "report")` answers from the rules as usual. The Drizzle map says the same with `defineTables(ac, { report: null })`. A screen keyed by something — a workspace id from the route — has a row after all; see [screens and tabs](./react.md#screens-and-tabs).

## Validating data with a real schema

Pass a Standard Schema instead of `shape<T>()` and the shape is inferred from it:

```ts
import { z } from "zod";

const ac = defineAbilities({
	resources: {
		post: {
			schema: z.object({ id: z.string(), title: z.string().min(3), status: z.enum(["draft", "published"]) }),
			actions: ["read", "update"],
		},
	},
});

ability.validate("post", input); // { ok: true, value } | { ok: false, issues }
```

`validate` answers *is this a valid post*; [`validatePayload`](./mutations.md) answers *may this actor write it*. Arguments a model invented for a tool call need both.

The schema must validate synchronously: Zod, Valibot and ArkType work, Yup does not — its validation is async, and `validate` throws. Checks and rules never consult the schema.

## Why it works this way

- **Nothing is written twice.** Action literals are captured by a `const` type parameter, and each resource keeps its own shape.
- **Names are checked where rules are written.** `createRules` refuses an action, a resource or a field you did not declare. Rules arriving as JSON are checked for shape only — see [parse](./parse.md#names-are-not-checked).

## Source

[`create/define-abilities.ts`](../packages/core/src/create/define-abilities.ts) · [`create/schema.ts`](../packages/core/src/create/schema.ts) · [tests](../packages/core/tests/create/define-abilities.test.ts)
