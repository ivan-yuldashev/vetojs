# ⚡ @vetojs

> Rules are plain JSON. Types infer themselves. 0 dependencies.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Fcore?label=%40vetojs%2Fcore)](https://www.npmjs.com/package/@vetojs/core)
[![Bundle size](https://img.shields.io/bundlejs/size/%40vetojs%2Fcore)](https://bundlejs.com/?q=%40vetojs%2Fcore)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](packages/core/package.json)
[![License](https://img.shields.io/npm/l/%40vetojs%2Fcore)](LICENSE)

**[English](README.md) · [Русский](README.ru.md)**

**Type-safe authorization with no classes, no magic, and no hidden state.**

A policy is a pure function: it takes a user (or any other context you need) and returns an array of rules as plain JSON.

Access is usually written three times over: an `if` in the handler, a `WHERE` in the query, and a hand-rolled field sweep before the `UPDATE`. Three implementations of one rule, drifting apart one at a time. Here a single array answers all three: may this user take this action, which rows to return from the database, and which fields they may write.

## Why @vetojs

- **Types infer themselves.** One `defineAbilities` declaration — from there your editor fills in actions, resources, fields and operators. No hand-written generics, no `any`.
- **Rules cross to the client unwrapped.** They are a JSON array, not a class instance. Put it in a server component's props, in a SvelteKit `load`, or in a Nuxt payload, and it works on the other side as it is.
- **Access is not written twice for SQL.** `ability.where()` turns the rules into a query condition, and [`@vetojs/drizzle`](docs/drizzle.md) into SQL. A test walks both paths, so a list never shows a row `can()` denies.
- **Writes are checked field by field, not wholesale.** [`validatePayload`](docs/mutations.md) inspects every key of the payload and, on refusal, returns `violations: [{ field, reason }]`. That names the field to fix: an API client can answer with it, and a model can correct itself instead of repeating the same call.
- **Rules can live in a database.** [`parseRules`](docs/parse.md) checks the JSON that arrives at the boundary: a grant it does not recognise is dropped, a **denial** it does not recognise is kept. So a database that ran ahead of the deploy can only narrow access.
- **Bad data never opens a door.** A wrong-typed field or a missing key answers *unknown*. A grant does not fire on that verdict; a denial does — access can only narrow, never widen.
- **5.4 kB gzipped.** That is the whole client-side path: validate the rules that arrived, build an ability, check a row. If the rules are already trusted, the size drops to 4.0 kB, and a check inside a server component costs a mere 98 bytes.
- **0 dependencies.** One package to update and audit, not a tree.
- **Runs anywhere JavaScript does.** Node, the browser, Cloudflare Workers, Vercel Edge, Deno, Bun — the same bundle, with no platform branches.
- **An assistant can pick it up on its own.** The whole API sits on one page — [docs/for-agents.md](docs/for-agents.md) and [llms.txt](llms.txt): hand the link to Claude, Cursor or Copilot and the suggestions land.

---

## Quick Start

### 1. Install

```sh
npm install @vetojs/core
# or
pnpm add @vetojs/core
```

ESM only, Node.js 20 or newer.

### 2. Declare your resources and your policy

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";
import type { ActionFor, ResourceName } from "@vetojs/core";

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

const { allow } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
];

const ability = buildAbility(ac, policyFor({ id: "u_1" }));
```

### 3. Ask — the types are already inferred

`defineAbilities` is the one place you declare anything by hand. The list of resources, and the list of actions for each, your editor works out on its own:

```ts
type Resources = ResourceName<typeof ac>;
//   ^? "post" | "user"

type PostActions = ActionFor<typeof ac, "post">;
//   ^? "read" | "update" | "publish" | "manage"

ability.can("publish", "post", post);
//           ^| autocomplete offers these four and nothing else
```

`manage` is added to every resource — a wildcard action that covers all the others.

The errors come from the same place:

```ts
ability.can("archive", "post");
//          ^^^^^^^^^ ✗ Argument of type '"archive"' is not assignable to parameter of type 'ActionFor<…, "post">'

allow("read", "post", { where: { statuz: "published" } });
//                               ^^^^^^ ✗ Object literal may only specify known properties, but 'statuz' does not exist… Did you mean to write 'status'?

allow("read", "post", { where: { status: "archived" } });
//                                       ^^^^^^^^^^ ✗ Type '"archived"' is not assignable to type '"draft" | "published" | ScalarOperators<…>'
```

An action, resource, field or value that drifts from the declaration is a compile error, not a refusal in production.

## Comparison

CASL answers the same question on a different foundation. Below are the places where the difference shows up directly in your code; every line was checked by running it against `@casl/ability@7.0.1`.

| Task | CASL | @vetojs |
|---|---|---|
| **Send permissions to the client** | The ability is a class instance and does not serialize. What crosses is `ability.rules`, and the ability has to be rebuilt there — with the `createMongoAbility(rules)` factory, because it supplies the conditions matcher itself. The bare `new Ability(rules)` constructor, without such a matcher, simply throws. | There is nothing to send: `ability.rules` **is** the policy. On the other side `buildAbility(ac, rules)` is a function over that same array. |
| **Check one specific row** | The row has to be tagged first. `subject("Post", post)` **mutates** the object, adding a non-enumerable `__caslSubjectType__` field; `JSON.stringify` does not keep it, so a row that arrived from the server is refused. | The resource name is an argument: `can("update", "post", post)`. Your object is left untouched. |
| **Declare actions and resources** | Action-and-subject pairs are listed in the type by hand: `MongoAbility<["create" \| "manage", "campaign"] \| ["create" \| "delete", "user"]>`. The list grows with the policy. | One `defineAbilities` declaration. Actions, resources and the shape of every row are inferred from it. |
| **Filter a database query** | `accessibleBy` only works through an adapter for a specific ORM. Prisma and Mongoose have one; for [SQL and Sequelize the request has been open since 2017](https://github.com/stalniy/casl/issues/8). | `ability.where()` returns a condition tree you can compile yourself. `@vetojs/drizzle` compiles it to SQL, and a test compares the result row by row: the query returns exactly what `can()` allows. |
| **A value of the wrong type** | The comparison coerces: `{ views: { $gt: 50 } }` lets `views: "100"` through, and a `deny` on `secret: true` does not fire for `secret: "true"` — the prohibition silently fails to apply. | The verdict is *unknown*: an `allow` grants nothing, a `deny` still fires. A corrupt value can only narrow access. |
| **Take it into a project** | 1 direct dependency, 4 in the tree | 0 dependencies |

Size matters where the rules travel to the browser. [A test](packages/core/tests/readme-size.test.ts) bundles both libraries the same way — esbuild, minified, then gzipped:

| | CASL | @vetojs |
|---|---|---|
| build an ability from trusted rules, check a row | 6.3 kB gzip | **4.0 kB gzip** |
| the same, having first validated the rules that arrived | no equivalent step | 5.4 kB gzip |
| the whole package | 6.9 kB gzip | 6.7 kB gzip |
| gate a server component | — | 98 bytes |

[Migrating from CASL](docs/migrate-from-casl.md) maps the API across, names the operators that have no equivalent, and covers the three behaviour differences that can change what your policy decides.

## What a check costs

Authorization does not fire once per request: it fires on every render, every row of a list, every button. So the number that matters is not one check but its cost in a loop.

A condition is compiled into a function the first time it runs, and the ability keeps it. The first check of a resource pays for the compile, every one after it calls a ready function — the shape a first render wants, and the shape SSR wants when one policy answers about a page full of rows.

Measured on a five-rule policy, among them `allow(["update", "publish"], "post", { where: { authorId: user.id, status: { ne: "draft" } } })`, over a hundred rows, on Node 24:

| | |
|---|---|
| build the ability for a request | 0.19 µs |
| check one row | 0.17 µs |
| gate a hundred rows | 9.3 µs |
| build, then gate a hundred rows | 13 µs |
| `ability.where()` for the database | 0.4 µs |
| parse rules that arrived as text, validate them, then build | 6.6 µs |

`ability.where()` removes the gating wherever the rows arrive by query: the database hands back only the permitted ones and there is nothing left to check in JavaScript. What is already in memory — a nested comment list, a third-party API response — still goes through `can()`.

[`parseRules`](docs/parse.md) is the trust boundary, and the one place worth caching when a policy is fetched per request rather than per session.

Compared with `@casl/ability@7.0.1` on the same rules and the same rows, median of ten runs. Next to each number, the moment something pays it:

- **Building the policy: ~38× faster here.** A server component builds the ability on every render and every navigation, so this is the cost of a single request. CASL indexes its rules up front and spends about 11 µs on 222 of them; `buildAbility` builds nothing — it closes over the array and spends 0.3.
- **Refusing a row: 2.6× faster here.** "No" is the common answer — a hidden button, a row left out of a list — and a list repeats it a hundred times over.
- **Reaching through a relation: 1.4× faster here.** Multi-tenant policies almost always check membership along a chain like `post.blog.workspace`, so this is not a rare case but the main path.
- **A 222-rule policy where an early rule grants: 7.7–10× faster here.** That is what a policy looks like when it is generated per tenant instead of per role. When nothing matches at all, the margin falls to 1.7×.
- **The same 222 rules when the granting rule sits last: 2.3× faster there.** CASL's precedence is positional: it stops at the first rule that matches. Here a `deny` wins wherever it sits, so a yes has to see every prohibition. The loss shows up only on a policy [you should not write anyway](docs/create-rules.md#one-rule-per-role-not-per-tenant): grouped by role, those 222 rules collapse to a dozen, and you are back at the previous point.

## The package ecosystem

| Package | Status | What it does |
|---|---|---|
| [`@vetojs/core`](packages/core) | ✅ Ready | The engine: rules, evaluation, operators, and building conditions for queries. No dependencies. |
| [`@vetojs/react`](packages/react) | ✅ Ready | [`<Can>`, `useAbility`, `AbilityProvider`](docs/react.md) — the same rules show and hide interface elements. |
| `@vetojs/core/guard` | ✅ Ready | [`createGuard`](docs/guard.md) — one wrapper for a server action, an HTTP handler or an agent tool call: it resolves the user, loads the row, validates the data, and only then lets the call through. |
| [`@vetojs/drizzle`](packages/drizzle) | ✅ Ready | [Conditions → SQL `WHERE`](docs/drizzle.md), relations → `EXISTS`. Postgres for now. |
| `@vetojs/prisma` · `@vetojs/kysely` | 🔜 Planned | Until they ship, an adapter is a hand-rolled thing: `ability.where()` returns a `ConditionNode` — a tagged condition tree from the public API. [How to read it](docs/where.md). |

## The same rules in every layer

An access decision is not made in one place: it happens in the handler, in the database query, while a page renders, in an agent's tool call. All of them ask the same policy function — and none of them needs a package of its own.

- **[Server actions and RSC](docs/guard.md)** — `createGuard` resolves the user, loads the row, validates the payload, and only then runs the handler.
- **[HTTP handlers](docs/http.md)** — Express, Fastify, Hono. A handler is a function, and the guard wraps functions; what differs is only where the user sits on the request and how a refusal becomes a status.
- **[Agent tool calls](docs/agents.md)** — the arguments were invented by a model, not filled in by a person. The policy answers whether *this* row may be touched by the person the agent acts for, and the refusal names the field — which is what makes a model correct itself instead of repeating the same call.
- **[Server rendering beyond RSC](docs/ssr.md)** — SvelteKit's `load`, Nuxt's payload, Astro's island props, React Router's loaders. Rules are JSON, so they travel in whatever channel the framework already has.
- **[The database](docs/where.md)** — the same rules as a `WHERE`, on reads and on writes alike, with the guarantee that the query returns exactly what `can()` allows.
- **[Alongside Postgres RLS](docs/rls.md)** — how the two compose, and three situations where row-level security silently stops protecting anything: the table owner bypasses policies without `FORCE`, the actor setting is lost behind a pooler, and a prohibition without `AS RESTRICTIVE` prohibits nothing.

### From the database to the button — one array of rules

Below, one and the same post passes through four layers. On none of them are the permissions written out again.

The database query returns only permitted rows: `schema.filter` puts the rules' condition into the `WHERE`.

```ts
const rows = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post"));
```

The same predicate belongs on a write. A row the policy hides does not match, so the statement touches nothing, and no window is left between reading and checking:

```ts
const [updated] = await db.update(posts).set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();
```

A server component checks access to a specific row and hands the rules to the client as flat data:

```tsx
const ability = buildAbility(ac, policyFor(user));
if (!ability.can("read", "post", post)) notFound();

return (
	<AbilityProvider rules={ability.rules}>
		<Toolbar post={post} />
	</AbilityProvider>
);
```

On the client those same rules drive the interface:

```tsx
"use client";

<Can I="update" a="post" this={post} fallback={<DisabledButton />}>
	<EditButton />
</Can>
```

The button, the request and the row in the database all rest on one array of JSON rules, so there is nowhere for them to drift apart.

## Roadmap

- `@vetojs/prisma` and `@vetojs/kysely` — the same conditions in two more ORMs.
- Dialects beyond Postgres in `@vetojs/drizzle`.
- `@vetojs/next` is no longer developed: the guard moved to `@vetojs/core/guard` and works with any framework.

Missing an entry of your own? [Open an issue](https://github.com/ivan-yuldashev/vetojs/issues/new) — which ORM, which framework, which scenario. What gets asked for is what gets ordered.

## Contributing

Issues and pull requests go to [the repository](https://github.com/ivan-yuldashev/vetojs/issues). The workflow, the commit requirements and the changeset are described in [CONTRIBUTING.md](CONTRIBUTING.md), the ground rules in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and vulnerability reports in [SECURITY.md](SECURITY.md).

```sh
pnpm install
pnpm test           # vitest
pnpm test:coverage
pnpm typecheck      # tsc across the workspace
pnpm check          # biome
pnpm knip           # unused-export gate
```

## What's next

- **[Documentation](docs/README.md)** — a detailed page per concept: from declaring resources to SQL filtering.
- **[For agents](docs/for-agents.md)** — the whole API on one page, sized to fit an AI assistant's context (plus the [llms.txt](llms.txt) file).
- **Examples** — three runnable demos over one multi-tenant domain: [react-spa](examples/react-spa) (rules crossing to the client), [next-app](examples/next-app) (RSC, server actions, SQL filtering) and [drizzle-pg](examples/drizzle-pg) (`can()` and `WHERE` compared row by row).

## License

MIT
