# @vetojs

**[English](README.md) · [Русский](README.ru.md)**

**Type-safe authorization with no classes, no magic, and no hidden state.**

A policy is a pure function. It takes a user (or any other context you need) and returns an array of rules as plain JSON. That array travels from server to client without ceremony. The same array is what checks permissions, with full type inference, and what turns elegantly into a safe `WHERE` clause for your database.

- **Rules are flat data, so they cross any boundary.** A perfect fit for React Server Components — and equally for a SvelteKit `load`, a Nuxt payload, or an agent's tool call.
- **Compiles to SQL automatically.** The policy behind `can()` translates into a `WHERE` clause. The database returns exactly the rows the user is allowed to see.
- **Writes are checked field by field.** [`validatePayload`](docs/mutations.md) answers which fields and which values this actor may write, and names each violation — the sentence an API client, or a model, needs to fix its request.
- **Rules can live in a database.** [`parseRules`](docs/parse.md) validates untrusted rule JSON at the boundary, and a rule the code doesn't recognise is dropped — so a database ahead of the deploy can only ever narrow access.
- **Safe on bad data.** A wrong-typed value or a missing field can narrow access, but will never widen it.
- **5.3 kB gzipped.** That buys you validation of the rules arriving from the server, building an ability, and checking a row. If the rules are already trusted, the size drops to 3.9 kB. A check inside a server component costs a mere 98 bytes.
- **0 dependencies.** There is exactly one thing to audit for security — the code that actually governs access.
- **Runs anywhere JavaScript does.** No ties to Node built-ins, the filesystem, or dynamic evaluation. Workers, Deno, Bun and any edge runtime are supported natively.

```sh
npm install @vetojs/core
```

## How it works: three simple steps

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";

// 1. Declare your resource schema once.
const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published" }>(),
			actions: ["read", "update", "publish"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

// 2. A policy is a function that returns an array of rules.
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
];

// 3. Hand the rules to the engine — and check access.
const ability = buildAbility(ac, policyFor(currentUser));

ability.can("update", "post", post);  // ✓ typed against your schema
ability.can("delete", "post");        // ✗ compile error — "post" has no "delete"
```

Typos no longer reach production: if an action, resource, field or operator doesn't match your types, the code simply won't compile.

## Why not CASL?

CASL is an excellent tool and the acknowledged incumbent. But it was built before the era of React Server Components, and class instances sit at its foundation — which is where our architectures part ways. The comparison holds for `@casl/ability@7.0.1`.

| | CASL | @vetojs |
|---|---|---|
| **Server → client** | An ability is a `PureAbility` instance, and RSC refuses to pass it through: *"Only plain objects… Classes or null prototypes are not supported"* ([#999](https://github.com/stalniy/casl/issues/999)). | `ability.rules` is plain JSON. The client rebuilds the ability from it with ease. |
| **Tagging an instance** | `subject("Post", post)` **mutates** `post` itself, adding a non-enumerable tag. `JSON.stringify` therefore drops it, and the type is lost silently. | `can("update", "post", post)` takes the resource name as a plain argument. No wrappers, no mutated data. |
| **Types** | Actions do narrow per resource, but the unions are often hand-written (for example: `MongoAbility<["create" \| "manage", "campaign"] \| ["create" \| "delete", "user"]>`). | Actions, resources and shapes are all inferred automatically from one `defineAbilities` declaration. |
| **Database queries** | `accessibleBy` needs a separate adapter per ORM. SQL support has been [open since 2017](https://github.com/stalniy/casl/issues/8), and each new ORM major means waiting for an adapter release. | `ability.where()` returns a standard condition tree that is easy to walk yourself. `@vetojs/drizzle` turns it straight into SQL, with a guarantee: the query returns exactly what `can()` allows. |
| **Dependencies** | 4 | 0 |
| **Bundle size** | ~7.0 kB for the whole package (6.3 kB gzip to build and check). Code you never use ships anyway — `$elemMatch`, for instance, even if your policy never touches it. | 5.3 kB gzip for the same check with the incoming rules validated. 3.9 kB without validation. The whole package is 6.6 kB. |
| **Bad data** | `$gt: 50` can let a `views: "100"` row through, and a `deny` on `secret: true` won't fire for `secret: "true"`. | A value that doesn't fit its condition is strictly "unknown". An `allow` won't fire, and a `deny` will fire reliably. |

Coming from CASL? [Migrating from CASL](docs/migrate-from-casl.md) maps the API across in detail, names the operators that have no equivalent, and covers the two behaviour differences that can change what your policy does.

## What a check costs

A condition is turned into a function the first time it runs, and the ability keeps it. So the first check of a resource pays for the compile and every check after it calls a function — which is the shape a first render wants, and the shape SSR wants when the same policy answers about a page full of rows.

Measured on the policy a real app writes — five rules, among them `allow(["update", "publish"], "post", { where: { authorId: user.id, status: { ne: "draft" } } })` — against a hundred rows, on Node 24:

| | |
|---|---|
| build the ability for a request | 0.11 µs |
| check one row | 0.12 µs |
| gate a hundred rows | 6.7 µs |
| build, then gate a hundred rows | 8.4 µs |
| `ability.where()` for the database | 0.3 µs |
| parse rules that arrived as text, validate them, then build | 5.0 µs |

Two of those are the ones to remember. **Eight microseconds** is what a request pays to build the policy and decide about a hundred rows — the rest of the request will not notice. And `ability.where()` at **0.3 µs** is the alternative to all of it: hand the condition to the database and gate nothing in JavaScript.

Rules that arrive as text cost about three quarters of what gating a hundred rows costs — [`parseRules`](docs/parse.md) is the trust boundary, and it is the one place worth caching if a policy is fetched per request rather than per session.

Against `@casl/ability@7.0.1` on the same rules and the same rows, both engines as their published bundles, median of ten runs — each number next to the moment something pays it:

- **Building the policy: ~45× faster here.** This is the per-request cost. A server component builds the ability on every render and every navigation; CASL indexes its rules up front and spends about 8 µs doing it; we take a copy of the array and spend 0.2. On a page made of a few dozen gated components, that is the difference between a warm-up you can measure and none at all.
- **Refusing a row: 2.6× faster here.** The negative answer is the common one — a hidden button, a row left out of a list — and a list pays for it a hundred times over.
- **Reaching through a loaded relation: 1.4× faster here.** Membership rules — `post.blog.workspace` — are how multi-tenant policies are written, so this is the path a real one takes.
- **A 222-rule policy where an early rule grants: 8–10× faster here.** That is what a policy looks like when it is generated per tenant instead of per role.
- **The same 222 rules when the granting rule sits last: 2.3× faster there.** A `deny` wins wherever it sits, so a yes has to see every prohibition, while CASL stops at the first rule that matches — its precedence is positional. That is the price of rules being a set rather than a list, and it is [the policy shape to avoid anyway](docs/create-rules.md#one-rule-per-role-not-per-tenant): grouped by role, those 222 rules collapse to a dozen, which is the second line above.


## The package ecosystem

| Package | Status | What it does |
|---|---|---|
| [`@vetojs/core`](packages/core) | ✅ Ready | The core: rules, evaluation, operators, and building conditions for queries. No dependencies. |
| [`@vetojs/react`](packages/react) | ✅ Ready | [`<Can>`, `useAbility`, `AbilityProvider`](docs/react.md) — the same rules decide which UI elements are available. |
| `@vetojs/core/guard` | ✅ Ready | [`createGuard`](docs/guard.md) — one wrapper for a server action, an HTTP handler or an agent tool call: works out the user, loads the row, validates the payload, and only then runs it. |
| [`@vetojs/drizzle`](packages/drizzle) | ✅ Ready | [Conditions → SQL `WHERE`](docs/drizzle.md), relations → `EXISTS`. Postgres for now. |
| `@vetojs/prisma` · `@vetojs/kysely` | 🔜 Planned | Support for further ORM adapters and dialects. |

## Where the same policy decides

One policy function, checked in every place a decision is actually made — and none of them needs a package of its own.

- **[Server actions and RSC](docs/guard.md)** — `createGuard` resolves the actor, loads the row, validates the payload, and only then runs the handler.
- **[HTTP handlers](docs/http.md)** — Express, Fastify, Hono. A handler is a function, and the guard wraps functions; what differs per framework is where the actor sits on the request and how a refusal becomes a status.
- **[Agent tool calls](docs/agents.md)** — the arguments are a model's guess, not a filled-in form. The same policy answers "may the person this agent acts for do this to *this* row", and the refusal names the field, which is what makes a model correct itself instead of retrying.
- **[Server rendering beyond RSC](docs/ssr.md)** — SvelteKit's `load`, Nuxt's payload, Astro's island props, React Router's loaders. Rules are JSON, so they travel in whatever channel the framework already has.
- **[The database](docs/where.md)** — the same rules as a `WHERE`, on reads and on writes alike, with the guarantee that the query returns exactly what `can()` allows.
- **[Alongside Postgres RLS](docs/rls.md)** — how the two compose, and the three ways row-level security silently protects nothing.

## One source of truth, from the database to the client

At the database level we ask only for what the user is permitted to see: the rules convert automatically into a `WHERE` clause.

```ts
const rows = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post"));
```

The same predicate belongs on a write. A row the policy hides does not match, so the statement touches nothing and there is no fetch-then-check window in between:

```ts
const [updated] = await db.update(posts).set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();
```

On the server — inside a server component — we check access to a specific row and safely hand the rules to the client as flat data:

```tsx
const ability = buildAbility(ac, policyFor(user));
if (!ability.can("read", "post", post)) notFound();

return (
	<AbilityProvider rules={ability.rules}>
		<Toolbar post={post} />
	</AbilityProvider>
);
```

On the client those very same rules drive the interface, hiding or showing the controls:

```tsx
"use client";

<Can I="update" a="post" this={post} fallback={<DisabledButton />}>
	<EditButton />
</Can>
```

Server and client both rely on one and the same array of JSON rules, so the access logic simply cannot drift apart.

## What's next

- **[Documentation](docs/README.md)** — a detailed page per concept: from declaring resources to SQL filtering.
- **[For agents](docs/for-agents.md)** — the whole API on one page, sized to fit an AI assistant's context (plus the [llms.txt](llms.txt) file).
- **Examples** — three runnable demos over one multi-tenant domain: [react-spa](examples/react-spa) (rules crossing to the client), [next-app](examples/next-app) (RSC, server actions, SQL filtering) and [drizzle-pg](examples/drizzle-pg) (`can()` and `WHERE` compared row by row).

## Development

```sh
pnpm install
pnpm test           # vitest
pnpm test:coverage
pnpm typecheck      # tsc across the workspace
pnpm check          # biome
pnpm knip           # unused-export gate
```

## License

MIT
