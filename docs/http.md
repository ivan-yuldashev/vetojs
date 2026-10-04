# HTTP handlers — Express, Fastify, Hono

**[English](http.md) · [Русский](http.ru.md)**

An HTTP handler is a function and the guard wraps functions, so no framework package is needed. What differs is where the actor sits on the request and how a refusal becomes a status.

## An ability per request

```ts
type AppBindings = {
	Variables: { ability: Ability<typeof ac>; user: { id: string } };
};

const authorization = createMiddleware<AppBindings>(async (c, next) => {
	c.set("ability", buildAbility(ac, policyFor(c.get("user"))));
	await next();
});
```

That is Hono. In Express the slot is typed by augmenting `Express.Request`, in Fastify by augmenting `FastifyRequest` inside `declare module "fastify"`.

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

`violations` tell an API client which field to fix.

## One row, through the filter

```ts
const [post] = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, "p1")));

const [updated] = await db.update(posts).set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();
```

An empty result means "missing or not yours"; answer 404 for both, so a caller cannot learn that a row exists. On a write the same predicate leaves no window between reading and checking. The guard's `payload` decides which fields; the filter decides which rows.

## What each framework adds

| | Where the actor comes from | Refusal → response |
|---|---|---|
| Express | `req.user` from your session middleware | an error handler mapping `ForbiddenError` to 403 |
| Fastify | `request.user`, or a decorator | `setErrorHandler` |
| Hono | `c.get("user")` from your auth middleware | `app.onError` |

## Why it works this way

- **The ability is per request.** It closes over one actor's rules; sharing one between users is the bug this makes hard to write.
- **Refusals are exceptions.** A handler that forgets to check fails loudly, and one error handler answers 403 for all of them.

## Source

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [the guard](./guard.md) · [filtering in the database](./where.md)
