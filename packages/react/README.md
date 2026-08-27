# ⚡ @vetojs/react

> Authorization in React: the same rules decide what is allowed on the server and what the interface shows.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Freact)](https://www.npmjs.com/package/@vetojs/react)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@vetojs/react?activeTab=dependencies)
[![React](https://img.shields.io/badge/react-%E2%89%A518-61dafb)](https://react.dev)
[![License](https://img.shields.io/npm/l/%40vetojs%2Freact)](https://github.com/ivan-yuldashev/vetojs/blob/main/LICENSE)
[![Socket](https://socket.dev/api/badge/npm/package/@vetojs/react)](https://socket.dev/npm/package/@vetojs/react)

React bindings for [`@vetojs`](https://github.com/ivan-yuldashev/vetojs#readme) — **[English](README.md) · [Русский](README.ru.md)**.

[`@vetojs`](https://github.com/ivan-yuldashev/vetojs#readme) describes permissions as an array of rules in plain JSON: which of your users may do what, and to which rows. The server builds that array for the current user and hands it to the client as it is — there is nothing to serialize, it is JSON already.

This package wires that very array into React. Buttons, tabs and lists ask it what to show, so no second copy of the access logic appears on the client.

## Why @vetojs/react

- **Types infer themselves.** `createVetoContext(ac)` closes over your schema: `<Can>` suggests the actions available to that specific resource and rejects the ones that don't exist.
- **RSC with no client boundary.** `@vetojs/react/server` gates a server component for **98 bytes** — no directives, no hooks, no context in the browser.
- **Targeted re-renders.** `useCan` subscribes to one verdict and wakes only the row whose answer changed.
- **0 dependencies.** `react` and `@vetojs/core` are peer dependencies; the package adds nothing of its own to the tree.

---

## Quick Start

### 1. Install

```sh
npm install @vetojs/react @vetojs/core
# or
pnpm add @vetojs/react @vetojs/core
```

ESM only, Node.js 20 or newer, React 18 or newer.

### 2. Build the bindings once

```ts
// src/authz.ts
import { createVetoContext } from "@vetojs/react";
import { defineAbilities, shape } from "@vetojs/core";

export const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published" }>(),
			actions: ["read", "update", "publish"],
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

export const { AbilityProvider, useAbility, useCan, useSetRules, Can } =
	createVetoContext(ac);
```

Why a factory rather than a ready-made import: typed bindings need your `ac`. That is where `<Can>` gets the list of actions for each resource.

### 3. Hand the rules to the tree

```tsx
<AbilityProvider rules={rules}>
	<App />
</AbilityProvider>
```

`rules` takes `ability.rules` — the same flat array the server sent. If you already built an ability on the client, pass `ability` instead of `rules`; both at once is not allowed, and the type enforces that.

### 4. Hide what there are no rights for

```tsx
<Can I="update" a="post" this={post} fallback={<DisabledButton />}>
	<EditButton />
</Can>
```

It reads as a sentence: "I may update *this* post." When the row doesn't exist yet — a "create" button, say — drop `this`, and the check answers whether the action is possible at all.

## Types infer themselves

The list of actions for `<Can>` and the hooks comes from your `ac` — the one declared in step 2:

```tsx
type Resources = ResourceName<typeof ac>;
//   ^? "post" | "user"

type PostActions = ActionFor<typeof ac, "post">;
//   ^? "read" | "update" | "publish" | "manage"

const canEdit = useCan("update", "post", post);
//    ^? boolean

<Can I="publish" a="post" this={post} fallback={<DisabledButton />}>
//     ^| autocomplete offers only these four actions
	<EditButton />
</Can>;
```

`manage` is added to every resource — a wildcard action that covers all the others.

An action that doesn't exist, and a provider with two sources of rules, are compile errors:

```tsx
<Can I="archive" a="post" this={post}>
//     ^^^^^^^^^ ✗ Type '"archive"' is not assignable to type 'ActionFor<…, "post">'
	<EditButton />
</Can>;

<AbilityProvider rules={rules} ability={ability}>
//                             ^^^^^^^ ✗ Type 'AbilitySet<…>' is not assignable to type 'undefined'
	<EditButton />
</AbilityProvider>;
```

## What to ask with: four tools

The question is the same; the tools are four. What differs is where you are and what re-renders.

| What you need | Tool | Where it works | What it costs |
|---|---|---|---|
| Gate markup in a server component | `<Can>` from `@vetojs/react/server` | RSC, SSR | 98 bytes, and the allowed and denied markup are both picked on the server |
| Gate markup on the client | `<Can>` from `createVetoContext` | client | a subscription to one verdict |
| One yes-or-no answer in logic | `useCan` | client | re-renders only when the verdict flips |
| Several checks, `permittedFields`, `where` | `useAbility` | client | re-renders on any change of rules |

`useAbility` outside `AbilityProvider` does not pretend that "everything is forbidden" — it throws immediately.

## On the server you don't need the context

In a server component the `ability` is already at hand — no provider, no hooks, no client boundary:

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>;
```

The resource schema is derived straight from the `ability` you pass in, so there is no factory here. Which of the two pieces of markup to show — `children` or `fallback` — is decided on the server, so only the chosen one reaches the browser, and the component itself never does.

## A targeted re-render instead of a broad one

`useCan` subscribes to one verdict, and `<Can>` uses it internally. In a list of fifty gated rows, a verdict change on one of them wakes one row, not fifty:

```tsx
const visible = postList.filter((item) => ability.can("read", "post", item));
const writable = ability.permittedFields("update", "post", ["title", "status"]);
```

## Switching actors without extra renders

New `rules` can be passed to the provider as a prop, but that prop lives in an ancestor's state — so the ancestor re-renders, and the whole tree beneath it. `useSetRules` writes straight into the internal store:

```tsx
const setRules = useSetRules();

const onSwitchActor = async (id: string) => {
	setRules(await fetchRulesFor(id));
};
```

Components higher up the tree are left alone, and only the rows whose verdict actually changed update. In short: `rules` is for seeding from the server, `useSetRules` is for switching context on the fly.

## Hiding a button is not protecting the data

A hidden interface element is a courtesy to the user, not protection: the request that button would have sent can be sent by hand. Every action is still checked on the server — by [the guard](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.md) or by `ability.authorize()`. The value of this package is elsewhere: the server and the interface read one array of rules, so the UI cannot drift away from the permissions that are real.

## Roadmap

The package covers its API completely: a provider, three hooks and two `<Can>` components. Beyond that only the engine changes — new capabilities arrive here together with [`@vetojs/core`](https://github.com/ivan-yuldashev/vetojs/tree/main/packages/core).

## Contributing

Missing a hook, an awkward prop, one re-render too many — [tell us in an issue](https://github.com/ivan-yuldashev/vetojs/issues/new). Wishes for the API are read alongside bug reports, and they shape what gets done next.

The workflow is described in [CONTRIBUTING.md](https://github.com/ivan-yuldashev/vetojs/blob/main/CONTRIBUTING.md), and vulnerability reports in [SECURITY.md](https://github.com/ivan-yuldashev/vetojs/blob/main/SECURITY.md).

## What's next

- **[Full guide](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/react.md)** — the provider, `<Can>`, `useAbility`, and the details of server components.
- **[About the project](https://github.com/ivan-yuldashev/vetojs#readme)** — the general concept behind `@vetojs` and how the engine is built.
- **[For agents](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.md)** and **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — the whole API on one page, sized to fit an AI assistant's context: hand the link to Claude, Cursor or Copilot.
- **Example** — [react-spa](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/react-spa): the rules travel to the client and drive the interface.

## License

MIT
