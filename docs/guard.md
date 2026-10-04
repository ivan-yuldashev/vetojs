# The guard — `@vetojs/core/guard`

**[English](guard.md) · [Русский](guard.ru.md)**

A server action, a route handler, an agent's tool — each is a public entry point anyone can call with any arguments. `createGuard` writes the steps once: find the actor, load the row, check, then run.

```ts
// lib/permissions.ts
import { createGuard } from "@vetojs/core/guard";
import { ac, policyFor } from "./abilities";
import { getActor } from "./auth";

export const withPermission = createGuard({ ac, getActor, policy: policyFor });
```

| Option | |
|---|---|
| `ac` | your declarations |
| `getActor` | finds the current user, may be async; `null` means nobody is signed in |
| `policy` | actor → rules |
| `getEnv` | reads the [environment](./define-abilities.md#the-requests-environment) of a call from the wrapped function's arguments; required when `ac` declares an `env`, refused otherwise |
| `onDeny` | what to do instead of throwing `ForbiddenError` |
| `onUnauthenticated` | what to do when nobody is signed in — answer 401 instead of the default 403 |
| `onDecision` | `(decision, actor, env)` for every decision — see [recording decisions](./ability.md#recording-decisions) |

The guard imports no framework, and a bundle that never imports it does not carry it.

## Wrap an action

```ts
"use server";

export const updatePost = withPermission(
	{
		action: "update",
		resource: "post",
		load: (form: FormData) => loadPost(form.get("id")),
		payload: (form: FormData) => ({ title: String(form.get("title")) }),
	},
	async (ctx) => {
		await db.update(posts).set(ctx.payload).where(eq(posts.id, ctx.row.id));
		revalidatePath("/posts");
	},
);
```

The wrapped function keeps its signature. The handler receives `ctx` first, then the original arguments:

| `ctx` | |
|---|---|
| `actor` | what `getActor` returned |
| `ability` | the built ability, bound to the environment when there is one |
| `row` | what `load` returned — never empty: an empty `load` is a refusal with `reason: "no row"` |
| `payload` | the validated data — write this, not the raw input |

## What gets checked

| You declare | The guard checks |
|---|---|
| `load` and `payload` | the action on the row, then the fields and values |
| `load` | the action on the row |
| `payload` | the fields and values without a row: an `allow` conditioned on rows grants nothing, a `deny` that reads rows refuses |
| neither | the action whatever the row: an `allow` with a `where` grants nothing |

The guard checks permissions, not shapes: `{ title: "no" }` passes against `z.string().min(3)`, because a malformed field is a 400, not a 403. Validate inside `payload`; whatever it throws reaches your error handler untouched:

```ts
const updateTitle = withPermission(
	{
		action: "update",
		resource: "post",
		load: (form: FormData) => loadPost(form.get("id")),
		payload: (form: FormData) => z.object({ title: z.string().min(3) }).parse({ title: form.get("title") }),
	},
	async (ctx) => ctx.payload,
);
```

## Denial

A failed check throws `ForbiddenError` with `action`, `resource` and, for a payload, `violations`. Or handle it centrally:

```ts
createGuard({ ac, getActor, policy: policyFor, onDeny: () => notFound() });
```

`onDeny` and `onUnauthenticated` must not return — `notFound()`, `redirect()` and `throw` all qualify. If one returns, the guard throws `ForbiddenError` anyway. Without `onUnauthenticated` a missing actor is refused with `ForbiddenError`. No policy is built and `onDecision` hears nothing, so this hook is the only place the attempt can be logged:

```ts
createGuard({
	ac,
	getActor,
	policy: policyFor,
	onUnauthenticated: ({ action, resource }) => {
		throw new Response(`sign in to ${action} ${resource}`, { status: 401 });
	},
});
```

## Where it plugs in

The guard never reads the arguments — `load` and `payload` do — so it wraps any handler that is a function:

- **A server action used by `useActionState`** receives `(previousState, formData)`; declare both parameters in `load` and `payload`.
- **An HTTP handler** — Express, Fastify, Hono: see [HTTP](./http.md).
- **An agent's tool call**: see [guarding what an agent does](./agents.md).

A list is a query, not an action — filter it with [`where`](./where.md).

## Why it works this way

- **Configured once, applied per action.** Each action names only what it acts on.
- **The ability is built per call**, from the actor, so nothing is shared between users.
- **`ctx.payload` is the validated copy**, so a refused field cannot reach the write by accident.

## Source

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [`guard/guard.types.ts`](../packages/core/src/guard/guard.types.ts) · [tests](../packages/core/tests/guard/guard.test.ts)
