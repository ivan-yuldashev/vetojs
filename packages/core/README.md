# ⚡ @vetojs/core

> Authorization for TypeScript: which of your users may do what in your application. Rules are plain JSON, types infer themselves, 0 dependencies.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Fcore)](https://www.npmjs.com/package/@vetojs/core)
[![Bundle size](https://img.shields.io/bundlejs/size/%40vetojs%2Fcore)](https://bundlejs.com/?q=%40vetojs%2Fcore)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@vetojs/core?activeTab=dependencies)
[![License](https://img.shields.io/npm/l/%40vetojs%2Fcore)](https://github.com/ivan-yuldashev/vetojs/blob/main/LICENSE)
[![Socket](https://socket.dev/api/badge/npm/package/@vetojs/core)](https://socket.dev/npm/package/@vetojs/core)

The engine of [`@vetojs`](https://github.com/ivan-yuldashev/vetojs#readme) — **[English](README.md) · [Русский](README.ru.md)**.

Authorization answers the question "may *this* user do *this* to *this* row". Here the answer comes from a policy — a pure function that takes a user (or any other context) and returns an array of rules as plain JSON.

That one array covers three places at once: the check in your code (`ability.can("update", "post", post)`), the `WHERE` condition for a database query, and the list of fields the user is allowed to write.

## Why @vetojs/core

- **Types infer themselves.** One `defineAbilities` declaration — from there your editor fills in actions, resources, fields and operators. No hand-written generics, no `any`.
- **Zero overhead.** 0 dependencies, ESM only, `sideEffects: false`. Building an ability and checking a row is 4.0 kB gzip; with validation of the rules that arrived, 5.4 kB.
- **Runs anywhere JavaScript does.** Node, the browser, Cloudflare Workers, Vercel Edge, Deno, Bun — the same bundle, with no platform branches.
- **No hidden state.** Bar two error classes, there are no classes in the package. `buildAbility` mutates nothing and caches nothing between requests.
- **An assistant can pick it up on its own.** The whole API sits on one page — [docs/for-agents.md](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.md) and [llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt): hand the link to Claude, Cursor or Copilot and the suggestions land.

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

The list of resources, and the list of actions for each, your editor takes straight from the declaration:

```ts
type Resources = ResourceName<typeof ac>;
//   ^? "post" | "user"

type PostActions = ActionFor<typeof ac, "post">;
//   ^? "read" | "update" | "publish" | "manage"

ability.can("publish", "post", post);
//           ^| autocomplete offers these four and nothing else
```

`manage` is added to every resource — a wildcard action that covers all the others.

Return types are inferred from the same place:

```ts
const filter = ability.where("read", "post");
//    ^? ConditionNode<{ id: string; authorId: string; status: "draft" | "published" }>

const writable = ability.permittedFields("update", "post", ["status"]);
//    ^? "status"[]

const forClient = ability.rules;
//    ^? CheckedRules — flat JSON, ready to travel in props
```

A typo in an action, a resource, a field or a value is a compile error, not a refusal in production:

```ts
ability.can("archive", "post");
//          ^^^^^^^^^ ✗ Argument of type '"archive"' is not assignable to parameter of type 'ActionFor<…, "post">'

allow("read", "post", { where: { statuz: "published" } });
//                               ^^^^^^ ✗ Object literal may only specify known properties, but 'statuz' does not exist… Did you mean to write 'status'?

allow("read", "post", { where: { status: "archived" } });
//                                       ^^^^^^^^^^ ✗ Type '"archived"' is not assignable to type '"draft" | "published" | ScalarOperators<…>'
```

## How it differs from CASL

CASL is the most widely used authorization library in the ecosystem, so that is what this compares against:

| Task | CASL | @vetojs/core |
|---|---|---|
| Dependencies | 1 direct, 4 in the tree | **0** |
| Build an ability and check a row | 6.3 kB gzip | **4.0 kB gzip** |
| Send permissions to the client | rebuild: `createMongoAbility(rules)` | the same array: `buildAbility(ac, rules)` |
| Declare actions and resources | list them as pairs in a generic | inferred from `defineAbilities` |
| Filter a database query | an adapter per ORM, and none for SQL | `ability.where()` returns a condition tree the `WHERE` is built from |
| RSC and edge runtimes | — | supported |

The figures come from [a test](https://github.com/ivan-yuldashev/vetojs/blob/main/packages/core/tests/readme-size.test.ts): both libraries go through esbuild, minification and gzip; the comparison was run against `@casl/ability@7.0.1`. [Migrating from CASL](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/migrate-from-casl.md) maps the API across line by line.

## Core API

The main entry point is four functions and one object.

- [`defineAbilities`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/define-abilities.md) — the single source of truth. Row shapes, actions and relations are all inferred from it.
- `shape<T>()` — declares a resource shape. For runtime validation, pass any schema compatible with [Standard Schema](https://standardschema.dev) instead: Zod, Valibot, ArkType.
- [`createRules(ac)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/create-rules.md) — hands back `allow` and `deny`, checked against your schema.
- [`buildAbility(ac, rules)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/ability.md) — turns a flat array into an `ability`.
- [`parseRules(json, ac)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/parse.md) — checks untrusted rule JSON at the boundary.
- [`markLoaded`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/relations.md) — marks a relation as loaded when the data was assembled by hand rather than by an ORM.
- `ConditionOperator` — `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`, `has`, `hasAny`, `hasAll`.
- `ForbiddenError`, `RelationNotLoadedError` — the only two classes in the package.

What `ability` can do:

| Method | The question it answers |
|---|---|
| `can`, `cannot`, `authorize` | is this action allowed — in general, or for this row |
| `canMutate`, [`validatePayload`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/mutations.md) | may these fields be written with these values |
| `permittedFields` | which fields to leave editable in a form |
| [`where`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/where.md) | which condition to hand the database |
| `validate` | does the incoming data fit the resource's schema |
| `rules` | what to send to the client |

### A refusal names the field

`validatePayload` inspects every key of the payload and, on refusal, returns `violations` — which shows exactly what to fix:

```ts
const result = ability.validatePayload("update", "post", post, { status: "published" });
//    ^? PayloadResult<Post> — { ok: true; data } | { ok: false; violations }

if (!result.ok) {
	result.violations;
	//     ^? Violation[] — [{ field: "status", reason: … }], exported as PayloadViolation
}
```

An API client can see from that answer what to correct; a model can see what to put in place of the argument, so it does not repeat the same call.

## The guard: one wrapper for every entry point

The second entry point is [`@vetojs/core/guard`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.md). `createGuard` describes once how to find the user and which policy to build for them:

```ts
import { createGuard } from "@vetojs/core/guard";

export const withPermission = createGuard({
	ac: accessControl,
	getActor: currentActor,
	policy: policyFor,
});
```

From there each action names only two things: what it does and to which resource. The wrapper resolves the user, loads the row, validates the payload and only then enters the handler — the same way for a server action, an [HTTP handler](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/http.md) and an [agent tool call](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/agents.md).

```ts
const publishPost = withPermission(
	{ action: "publish", resource: "post", load: (id: string) => loadPost(id) },
	async (ctx, id: string) => {
		ctx.row;
		//  ^? Post — `load` is declared, so there is a row, not a maybe-row
		ctx.actor;
		//  ^? { id: string } — whatever getActor returned
		return { id, status: ctx.row.status };
	},
);
```

The wrapped function keeps its original signature: `(id: string) => Promise<…>`. Your calling code does not change.

## Predictable behaviour on bad data

Databases hold `NULL`s, and clients send text where a number was expected. When no condition can be answered honestly, the engine does not guess — it returns the verdict **"unknown"**.

That is safe in both directions: an `allow` grants nothing on it, a `deny` fires anyway. Bad data can only narrow access ([more about operators](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/operators.md)).

### With relations the engine is stricter

If a rule inspects `post.author.role`, the author must be loaded together with the post. A forgotten `include` is a bug in the query, not a reason to silently change permissions, so `can()` does not answer "doesn't match" — it **throws** `RelationNotLoadedError`:

```ts
const post = await db.query.posts.findFirst({ with: { author: true } });
ability.can("update", "post", post);
```

The convention is the one your ORM uses: `undefined` means the relation was not loaded, `null` means it was loaded and is empty.

If you assembled the row not by query but by hand — stitched from two responses, pulled from a cache — the engine has to be told: `markLoaded(post, "author", author)` returns a copy tagged "the author is loaded". Without it the relation counts as unloaded and `can()` throws ([more about relations](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/relations.md)).

## Contributing

Missing an operator, a scenario that does not fit, an error message that gets in the way — [tell us in an issue](https://github.com/ivan-yuldashev/vetojs/issues/new). Wishes for the API are read alongside bug reports, and they shape what gets done next.

The workflow is described in [CONTRIBUTING.md](https://github.com/ivan-yuldashev/vetojs/blob/main/CONTRIBUTING.md), and vulnerability reports in [SECURITY.md](https://github.com/ivan-yuldashev/vetojs/blob/main/SECURITY.md).

## What's next

- **[Documentation](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/README.md)** — detailed pages on every concept: from declaring resources to SQL filtering.
- **[For agents](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.md)** and **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — the whole API on one page, sized to fit an AI assistant's context: hand the link to Claude, Cursor or Copilot.
- **Examples** — three runnable demos over one multi-tenant domain: [react-spa](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/react-spa), [next-app](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/next-app) and [drizzle-pg](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/drizzle-pg), where `can()` and the compiled `WHERE` are compared row by row.

## License

MIT
