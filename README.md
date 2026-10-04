# ⚡ @vetojs

> Authorization for TypeScript apps and the AI agents working in them. Write a permission once — the handler, the SQL query, the interface and every tool call obey it.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Fcore?label=%40vetojs%2Fcore)](https://www.npmjs.com/package/@vetojs/core)
[![License](https://img.shields.io/npm/l/%40vetojs%2Fcore)](LICENSE)

**[English](README.md) · [Русский](README.ru.md)**

Access is usually written four times: an `if` in the handler, a `WHERE` in the query, a field sweep before the `UPDATE` — and, once an agent joins the app, a line in its system prompt asking it to stay inside the user's data. Four copies of one rule drift apart one at a time, and the fourth is not a rule at all: whatever one prompt asks, another can talk the model out of.

Here a permission is written once. A policy is a function that takes the user and returns an array of rules, and that one array:

- **answers `can()`** — may this user take this action on this row;
- **becomes the `WHERE` of a query** — a list returns exactly the rows `can()` allows, and a test holds both paths to the same rows against Postgres, `NULL`s included;
- **checks a write field by field** — and a refusal names the field to fix;
- **decides what an agent's tool call may touch** — on behalf of the person the agent acts for;
- **reaches the client as it is** — and decides what the interface shows.

## When the caller is an AI agent

A tool call is an endpoint with a language model on the other side. Its arguments are not a form a person filled in but a guess, and a model will ask for someone else's row the moment the schema says `id: string`.

So the question is not "may this agent edit posts" but "may the person it acts for publish *this* post" — the one the interface already asks, answered by the same policy. The `withPermission` that guards a server action wraps the tool as well:

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

The guard loads the row the model named and checks it against the person's policy before the handler runs. An id from another workspace is refused outright. A value the person may not set is refused with the field named — `violations: [{ field: "status", reason: "value not permitted" }]` — and once that goes into the tool's reply, the model fixes the argument instead of repeating the call.

- **Reads go through the same policy.** A search tool filters in SQL with `schema.filter` and returns what the person may see, not what the server may. Retrieval is where an over-permissioned agent leaks quietly: nothing throws, the model simply sees more.
- **A tool with no table behind it is judged too.** Mail, files, webhooks, payments: the row is built from the arguments the model chose — the recipient's domain, the amount, the directory it writes to — and the policy judges it like any other.
- **The agent can get less than its person.** Declare an environment key and deny on it — `deny("delete", "invoice", { when: { viaAgent: true } })` — and the same policy keeps the agent from deleting what the person may.
- **MCP and the Anthropic SDK need no wrapper package.** The actor comes from `extra.authInfo` in an MCP handler, or from the surrounding scope when a tool is defined per conversation.

veto limits authority; it does not detect manipulation. A model talked into something still gets no more than the person it acts for could do anyway — and that limit is data you can test, not a sentence in a prompt. [Guarding what an agent does](docs/agents.md) walks through the integrations end to end.

When an assistant is the one writing the code, the whole API sits on one page — [docs/for-agents.md](docs/for-agents.md), plus [llms.txt](llms.txt): hand the link to Claude, Cursor or Copilot and the suggestions land.

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
//           ^| autocomplete offers these three and nothing else
```

`manage` is added to every resource for rules — a wildcard that covers all the other actions. A question names the action it asks about, so `can` offers the declared ones and never `manage`.

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

## The same rules in every layer

- **[Server actions and HTTP handlers](docs/guard.md)** — `createGuard` resolves the user, loads the row, validates the payload, then runs the handler. Express, Fastify and Hono need [no package of their own](docs/http.md).
- **[Server rendering](docs/ssr.md)** — rules are JSON, so they travel in RSC props, SvelteKit's `load`, Nuxt's payload or Astro's island props.
- **[Postgres RLS](docs/rls.md)** — how the two compose, and three ways row-level security silently protects nothing.

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

## The package ecosystem

| Package | Status | What it does |
|---|---|---|
| [`@vetojs/core`](packages/core) | ✅ Ready | The engine: rules, evaluation, operators, and building conditions for queries. |
| [`@vetojs/react`](packages/react) | ✅ Ready | [`<Can>`, `useAbility`, `AbilityProvider`](docs/react.md) — the same rules show and hide interface elements. |
| `@vetojs/core/guard` | ✅ Ready | [`createGuard`](docs/guard.md) — one wrapper for a server action, an HTTP handler or an agent tool call: it resolves the user, loads the row, validates the data, and only then lets the call through. |
| [`@vetojs/drizzle`](packages/drizzle) | ✅ Ready | [Conditions → SQL `WHERE`](docs/drizzle.md), relations → `EXISTS`. Postgres for now. |
| `@vetojs/prisma` · `@vetojs/kysely` | 🔜 Planned | Until they ship, an adapter is a hand-rolled thing: `ability.where()` returns a `ConditionNode` — a tagged condition tree from the public API. [How to read it](docs/where.md). |

## How it's built

The questions that come once the idea fits: what happens on bad data, where the rules can live, what the library weighs and what it pulls in.

- **Bad data never opens a door.** A wrong-typed field or a missing key answers *unknown*. A grant does not fire on that verdict; a denial does — access can only narrow, never widen.
- **Rules can live in a database.** [`parseRules`](docs/parse.md) checks the shape of the JSON that arrives and reports every error with its path; `buildAbility` takes no rule that skipped it.
- **A condition can compare two fields of a row** — `{ spent: { lte: { ref: "limit" } } }` — in memory and in SQL alike.
- **A rule can depend on the request.** Declare an `env` — the hour, the IP, whether the session passed MFA — and a rule reads it in `when`; [`withEnv`](docs/ability.md#withenv--the-requests-environment) binds the values of one request. A key the request lacks never lifts a prohibition.
- **Rules are plain JSON, not class instances.** Put them in a server component's props, in a SvelteKit `load`, or in a Nuxt payload, and they work on the other side as they are.
- **No hidden state.** Bar two error classes, there are no classes in the package. `buildAbility` mutates nothing and caches nothing between requests.
- **Types infer themselves.** One `defineAbilities` declaration — from there your editor fills in actions, resources, fields and operators. No hand-written generics, no `any`.
- **5.5 kB gzipped.** That is the whole client-side path: validate the rules that arrived, build an ability, check a row. If the rules are already trusted, the size drops to 3.9 kB, and a check inside a server component costs a mere 98 bytes.
- **0 dependencies.** One package to update and audit, not a tree.
- **Runs anywhere JavaScript does.** Node, the browser, Cloudflare Workers, Vercel Edge, Deno, Bun — the same bundle, with no platform branches.

### What a check costs

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

## Compared with CASL

CASL answers the same question on a different foundation. If you are choosing between the two or moving across, below are the places where the difference shows up directly in your code; every line was checked by running it against `@casl/ability@7.0.1`.

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
| build an ability from trusted rules, check a row | 6.3 kB gzip | **3.9 kB gzip** |
| the same, having first validated the rules that arrived | no equivalent step | 5.5 kB gzip |
| the whole package | 6.9 kB gzip | 7.0 kB gzip |
| gate a server component | — | 98 bytes |

Speed was compared on the same rules and the same rows as in [what a check costs](#what-a-check-costs), median of ten runs. Next to each number, the moment something pays it:

- **Building the policy: ~38× faster here.** A server component builds the ability on every render and every navigation, so this is the cost of a single request. CASL indexes its rules up front and spends about 11 µs on 222 of them; `buildAbility` builds nothing — it closes over the array and spends 0.3.
- **Refusing a row: 2.6× faster here.** "No" is the common answer — a hidden button, a row left out of a list — and a list repeats it a hundred times over.
- **Reaching through a relation: 1.4× faster here.** Multi-tenant policies almost always check membership along a chain like `post.blog.workspace`, so this is not a rare case but the main path.
- **A 222-rule policy where an early rule grants: 7.7–10× faster here.** That is what a policy looks like when it is generated per tenant instead of per role. When nothing matches at all, the margin falls to 1.7×.
- **The same 222 rules when the granting rule sits last: 2.3× faster there.** CASL's precedence is positional: it stops at the first rule that matches. Here a `deny` wins wherever it sits, so a yes has to see every prohibition. The loss shows up only on a policy [you should not write anyway](docs/create-rules.md#one-rule-per-role-not-per-tenant): grouped by role, those 222 rules collapse to a dozen, and you are back at the previous point.

[Migrating from CASL](docs/migrate-from-casl.md) maps the API across, names the operators that have no equivalent, and covers the two behaviour differences that can change what your policy decides.

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
- **[Agents](docs/agents.md)** — guarding tool calls with the same policy, the per-field refusal a model can act on, and effects with no row behind them.
- **[For agents](docs/for-agents.md)** — the whole API on one page, sized to fit an AI assistant's context (plus the [llms.txt](llms.txt) file).
- **Examples** — three runnable demos over one multi-tenant domain: [react-spa](examples/react-spa) (rules crossing to the client), [next-app](examples/next-app) (RSC, server actions, SQL filtering) and [drizzle-pg](examples/drizzle-pg) (`can()` and `WHERE` compared row by row).

## License

MIT
