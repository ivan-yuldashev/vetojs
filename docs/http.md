# Express, Fastify, Hono, and anything with a handler

**[English](http.md) · [Русский](http.ru.md)**

There is no `@vetojs/express` and there will not be one. An HTTP handler is a function; the guard wraps functions. What differs between frameworks is where the actor lives on the request and how you turn a refusal into a status — a few lines each, not a package.

## Build the ability once per request

Whatever the framework calls it, the middleware does the same three things:

```ts
const abilityFor = async (actorId: string) => {
	const currentActor = { id: actorId };

	return buildAbility(ac, policyFor(currentActor));
};
```

Put the result on the request and every handler downstream has it. Building is cheap: a handful of closures over plain data, no cache to invalidate, nothing shared between users.

Each framework has one way to say "this slot holds an ability", and it is worth doing — the handlers then get the typed object rather than `unknown`:

```ts
type AppBindings = {
	Variables: {
		ability: Ability<typeof ac>;
		user: { id: string };
	};
};

const authorization = createMiddleware<AppBindings>(async (c, next) => {
	c.set("ability", buildAbility(ac, policyFor(c.get("user"))));

	await next();
});
```

In Express the slot is declared by augmenting the request — `declare global { namespace Express { interface Request { ability: Ability<typeof ac> } } }` — and in Fastify by augmenting `FastifyRequest` in a `declare module "fastify"` block. Same three lines, same result.

## Guard a write

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

`ctx.payload` is the validated copy — write that, not the raw body. The `violations` list names the field and the reason, which is what an API client needs to fix its request.

## Filter a read

A list is a query, not a check. Ask the database for what the actor may see:

```ts
const rows = await db
	.select()
	.from(posts)
	.where(schema.filter(ability, "read", "post"));
```

Fetching everything and filtering in the handler works until the second page: the count is wrong, the pagination is wrong, and the rows crossed the wire anyway. See [filtering in the database](./where.md).

## Fetching one row

The commonest shape in a CRUD API is "this row by id, if the policy allows it". Pass your own predicate to the adapter rather than composing outside it:

```ts
const row = await db
	.select()
	.from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, "p1")));
```

If it comes back empty, answer 404 rather than 403 — telling an anonymous caller that a row exists but is forbidden is itself a disclosure.

## Writing through the same filter

The predicate is a `WHERE`, so it belongs on an `UPDATE` and a `DELETE` too:

```ts
const [updated] = await db
	.update(posts)
	.set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();

if (updated === undefined) {
	notFound();
}
```

A row the policy hides does not match, so the statement touches nothing and you answer the same 404 as for a row that never existed — no fetch-then-check round trip, and no window between the two where the row could change. Use the guard's `payload` when the question is *which fields may this actor write*; use this when the question is *which rows may it write at all*.

## What each framework actually adds

| | Where the actor comes from | Turning a refusal into a response |
|---|---|---|
| Express | `req.user` from your session middleware | an error handler that maps `ForbiddenError` to 403 |
| Fastify | `request.user`, or a decorator | `setErrorHandler` |
| Hono | `c.get("user")` from your auth middleware | `app.onError` |
| FeathersJS | `context.params.user` | an error hook |

That table is the whole framework-specific surface, which is why this is a page and not four packages.

## Why it works this way

- **The guard never reads the request.** It takes your `load` and `payload` functions and the arguments you were already given, so it has nothing to adapt per framework.
- **The ability is per request, not per app.** It closes over one actor's rules; sharing one between users is the bug this design makes hard to write.
- **Refusals are exceptions, not return values.** A handler that forgets to check does not silently succeed — `authorize` and the guard throw, and your error handler answers 403 in one place.

## Source

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [the guard in general](./guard.md) · [filtering in the database](./where.md)
