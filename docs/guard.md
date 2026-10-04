# `@vetojs/core/guard` — one wrapper for anything with a boundary

**[English](guard.md) · [Русский](guard.ru.md)**

A server action, a route handler, a tool an agent may call — each is a public entry point. Whatever the UI shows, anyone can call it with any arguments, so each needs the same three steps: work out who is asking, load what they are acting on, check, then run. The guard writes those steps once.

```sh
npm install @vetojs/core
```

The guard ships in `@vetojs/core` under its own entry point, so a browser bundle that never imports it never pays for it. It knows nothing about any framework — it wraps your functions and calls them.

## Configure once

```ts
// lib/permissions.ts
import { createGuard } from "@vetojs/core/guard";
import { ac, policyFor } from "./abilities";
import { getActor } from "./auth";

export const withPermission = createGuard({ ac, getActor, policy: policyFor });
```

| Option | Meaning |
|---|---|
| `ac` | your resource declarations |
| `getActor` | how to find the current user — cookies, session, headers; may be async |
| `policy` | the actor → rules function |
| `onDeny` | optional: what to do instead of throwing (see below) |
| `onDecision` | optional: every decision, with the actor it was made for |
| `onUnauthenticated` | optional: what to do when nobody is signed in — answer 401 where the default reports 403 |

## Wrap an action

```ts
"use server";

export const updatePost = withPermission(
	{
		action: "update",
		resource: "post",
		load: (formData) => loadPost(formData.get("id")),
		payload: (formData) => ({ title: String(formData.get("title")) }),
	},
	async (ctx, formData) => {
		await db.update(posts).set(ctx.payload).where(eq(posts.id, ctx.row.id));
		revalidatePath("/posts");
	},
);
```

The actor is resolved, the policy built, the row loaded and checked, and the payload validated — all before your handler runs. If any of that fails, the handler is never reached.

`load` may come back empty — `findFirst` matched nothing, or the id belongs to someone else. That is a refusal, reported as `reason: "no row"`, and it is why `ctx.row` is typed as a row rather than a maybe-row: reaching your handler is proof one was found.

Your handler receives a context first, then the original arguments untouched:

| `ctx` | |
|---|---|
| `actor` | whatever `getActor` returned |
| `ability` | the built ability, if you need further checks |
| `row` | what `load` returned — a row, never a maybe-row |
| `payload` | the **validated** data — use this, not the raw input |

## What gets checked

It depends on what you declared, and the combinations are deliberate:

| You provide | The guard checks |
|---|---|
| `load` + `payload` | may this actor write this row, **and** are these fields and values permitted |
| `load` only | may this actor perform the action on this row |
| `payload` only | is the write permitted at all — and are these fields and values allowed |
| neither | may this actor perform the action whatever the row — an `allow` with a `where` grants nothing here |

Use `payload` for anything that writes. `ctx.payload` then holds the validated result, so a field the actor may not write cannot reach your database call even by accident.

**Validated means permitted, not well-formed.** The guard answers *may this actor write these fields and these values*; it does not run the resource's schema, so `{ title: "no" }` against `z.string().min(3)` passes it. That is deliberate: a malformed field is a bad request, not a forbidden one, and answering 403 for it would be wrong.

Validate shape where it belongs — in `payload`, which is your function:

```ts
const updatePost = withPermission(
	{
		action: "update",
		resource: "post",
		load: (form: FormData) => loadPost(form.get("id")),
		payload: (form: FormData) => postSchema.parse({ title: form.get("title") }),
	},
	async (ctx) => ctx.payload,
);
```

Whatever `payload` throws travels out untouched, so your validator's own error reaches your own error handler and becomes a 400. Most hosts already validate before this point — route handlers with a schema, tool calls against their input schema — in which case there is nothing to add. See [`ability.validate`](./ability.md) for the same check outside a guard.

The `payload`-only row is for creates, where there is no existing row to load. Row conditions can't be evaluated against something that doesn't exist yet, so the guard falls back to what it *can* decide: a `deny` that restricts rows refuses the write rather than waving it through, because without the row there is no way to tell whether it applies. A `deny` that only names payload fields or constraints says nothing about rows, so it does not refuse here — the payload check settles it, field by field. And because that check answers *what may this actor write*, a write no `allow` covers is refused too: an empty policy denies a create rather than waving it through.

## Denial

By default a failed check throws `ForbiddenError`, which carries `action`, `resource` and — for payload failures — the exact `violations`:

```ts
try {
	return await updatePost(formData);
} catch (error) {
	if (ForbiddenError.is(error)) {
		return { error: error.violations?.map((v) => `${v.field}: ${v.reason}`) };
	}
	throw error;
}
```

Or handle it centrally in the guard:

```ts
createGuard({
	ac,
	getActor,
	policy: policyFor,
	onDeny: () => notFound(),   // or redirect("/login")
});
```

Every decision a guarded action makes can be recorded, actor included:

```ts
const withPermission = createGuard({
	ac,
	getActor,
	policy: policyFor,
	onDecision: (decision, actor) => {
		log.info({ actor: actor.id, ...decision });
	},
});
```

The actor is the second argument rather than part of the report, because this
hook is configured once while the actor is resolved per call. What the report
carries, which calls do not produce one, and what a hook that throws does are on
[checking access](./ability.md) — here it costs one thing more: the exception is
not a `ForbiddenError`, so `onDeny` does not run and the handler never does.

Two refusals never reach the rules, and each is reported where it happens. When
`load` comes back with no row the decision carries `reason: "no row"` — the id was
someone else's or nothing at all, which reads differently in a log from a policy
saying no. When nobody is signed in there is no actor, so no policy and no
decision; `onUnauthenticated` receives what was attempted instead, and it is the
only place that attempt can be recorded:

```ts
onUnauthenticated: ({ action, resource }) => {
	log.warn({ action, resource, outcome: "no session" });
	throw new Response(null, { status: 401 });
},
```

`onDeny` must not return — `notFound()`, `redirect()` and `throw` all satisfy that, which keeps control flow linear for everything downstream. If one does return, the guard throws `ForbiddenError` anyway: the hook reports a denial, it never overturns one. `onUnauthenticated` works the same way.

## Where it plugs in

The wrapper never inspects the arguments — your `load` and `payload` read them — so it fits any host whose handler is a function. The host decides two things: where the actor comes from, and what a refusal looks like.

**Server actions consumed by `useActionState`** receive `(previousState, formData)`, and route handlers `(request, context)`. Neither needs an adapter:

```ts
export const publishPost = withPermission(
	{
		action: "publish",
		resource: "post",
		load: (_state: unknown, form: FormData) => loadPost(form.get("id")),
		payload: (_state: unknown, form: FormData) => ({
			title: String(form.get("title")),
		}),
	},
	async (ctx, _state: unknown, _form: FormData) => ctx.row.id,
);
```

**An HTTP handler** — Hono, Express, Fastify — needs no package of its own. The actor comes off the request, and a refusal becomes a status:

```ts
const update = withPermission(
	{
		action: "update",
		resource: "post",
		load: (id: string, _body: Partial<Post>) => loadPost(id),
		payload: (_id: string, body: Partial<Post>) => body,
	},
	async (ctx) => ctx.payload,
);

const respond = async (id: string, body: Partial<Post>) => {
	try {
		return { status: 200, body: await update(id, body) };
	} catch (error) {
		if (ForbiddenError.is(error)) {
			return { status: 403, body: { violations: error.violations } };
		}

		throw error;
	}
};
```

**A tool call** from an agent has the same shape, and the arguments are a guess rather than a filled-in form — the model will ask for a row belonging to someone else because the schema said `id: string`:

```ts
type PublishArgs = { id: string; status: "draft" | "published" };

const publish = withPermission(
	{
		action: "publish",
		resource: "post",
		load: (args: PublishArgs) => loadPost(args.id),
		payload: (args: PublishArgs) => ({ status: args.status }),
	},
	async (ctx) => `published ${ctx.row.id}`,
);
```

The row named by `args.id` is loaded and checked against the actor's policy, so a post from another workspace is refused before your handler runs — and the refusal carries `violations` per field, which is what lets a model correct itself instead of retrying blindly. [Guarding what an agent does](./agents.md) covers that in full, including the two traps: a tool with no row to load, and a schema the guard does not check.

A tool that takes arguments but has no row to load runs the `payload`-only path described above. Read that row of the table before relying on it: against a policy carrying a conditional `deny`, the guard refuses — by design, because an unknown row cannot prove the deny false.

## Fetching lists

The guard is for actions on things. A list is a query — filter it in the database instead, with the same policy:

```tsx
const ability = await getAbility();

const rows = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post"));
```

See [filtering in the database](./where.md) and the [Drizzle adapter](./drizzle.md).

## Why it works this way

- **Configured once, applied per action.** The actor and policy resolution live in one place; each action only says what it acts on.
- **Arguments pass through untouched.** Server actions, `useActionState` and route handlers all have different signatures, and one wrapper covers them because it never inspects the arguments itself — your `load` and `payload` functions do.
- **The ability is built per request**, from the actor. It's a handful of closures over plain data, not something to cache or share between users.
- **`ctx.payload` is the validated data.** Handing back the raw input would make it too easy to write the thing that was just rejected.

## Source

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [`guard/guard.types.ts`](../packages/core/src/guard/guard.types.ts) · [tests](../packages/core/tests/guard/guard.test.ts)
