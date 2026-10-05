# `@vetojs/react` — gating the UI

**[English](react.md) · [Русский](react.ru.md)**

The rules that guard your server decide what the interface shows. They reach the client as JSON, and the bindings read them.

```sh
npm install @vetojs/react @vetojs/core
```

React 18 or 19; `@vetojs/core` is a peer dependency.

## Create the bindings once

```ts
// src/authz.ts
import { createVetoContext } from "@vetojs/react";
import { ac } from "./abilities";

export const { AbilityProvider, useAbility, useCan, useSetRules, Can } = createVetoContext(ac);
```

The factory carries your `ac` type, so `<Can>` offers each resource's actions and rejects the rest. With an [`env`](./define-abilities.md#the-requests-environment) declared, pass `withEnv` as well: `createVetoContext(ac, withEnv)`.

If you publish the module in a package, annotate each export — `export const Can: VetoContext<AC>["Can"] = veto.Can` — or the emitted `.d.ts` repeats your whole resource map once per binding.

## Provide the rules

```tsx
<AbilityProvider rules={rules}>
	<App />
</AbilityProvider>
```

`rules` is `ability.rules` from the server — validate rules that arrive over the network with [`parseRules`](./parse.md). An ability you already built goes in `ability={ability}` instead; passing both is a type error. With an environment, the provider takes it beside the rules — `<AbilityProvider rules={rules} env={{ hour, mfa }}>` — and a change of either rebinds.

The provider rebuilds when `rules` changes identity, and a policy function returns a new array on every call. Memoise by the actor, or push changes with [`useSetRules`](#usesetrules--switch-actors).

## `<Can>`

```tsx
<Can I="update" a="post" this={post} fallback={<DisabledButton />}>
	<EditButton />
</Can>
```

Without `fallback` a refusal renders nothing. Drop `this` when no row exists yet — a "New post" button asks whether the action is possible at all:

```tsx
<Can I="create" a="post">
	<NewPostButton />
</Can>
```

```tsx
<Can I="archive" a="post">   {/* ✗ "post" has no "archive" action */}
<Can I="update" a="posts">   {/* ✗ no such resource */}
```

## `useCan` and `useAbility`

```tsx
const canEdit = useCan("update", "post", post);

const ability = useAbility();
const writable = ability.permittedFields("update", "post", post, ["title", "status"]);
```

`useCan` subscribes to one verdict and re-renders only when it flips; `<Can>` uses it inside. `useAbility` returns the whole [ability](./ability.md) and re-renders on any change of rules — use it for more than a yes or no. Outside a provider it throws rather than act as if nothing were permitted.

## `useSetRules` — switch actors

New `rules` passed as a prop re-render the ancestor that holds them and its whole subtree. `useSetRules` writes to the store instead, so only the verdicts that change update:

```tsx
const setRules = useSetRules();

const onSwitchActor = async (id: string) => {
	setRules(await fetchRulesFor(id));
};
```

## Screens and tabs

A tab or a settings page that no table backs is a resource too, and its row is what identifies this screen — usually the route parameters:

```tsx
const ac = defineAbilities({
	resources: { analytics: { schema: shape<{ workspaceId: string }>(), actions: ["view"] } },
});
const { Can } = createVetoContext(ac);

const AnalyticsTab = ({ workspaceId }: { workspaceId: string }) => (
	<Can I="view" a="analytics" this={{ workspaceId }} fallback={<Forbidden />}>
		<AnalyticsPanel />
	</Can>
);
```

Pass `this` whenever the screen has a parameter: without a row the answer is optimistic, and the tab would show in every workspace. A screen with nothing to key on leaves `schema` out. The server checks the same way — `can("view", "analytics", { workspaceId })` where the page renders — and the Drizzle map says `analytics: null`.

## Server components

On the server there is no context and no client boundary — ask the ability you have:

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>;
```

Both branches are decided while rendering, and only the chosen one reaches the browser. Build the ability once per request, with React's `cache` in Next; with an environment, bind it there — `withEnv(buildAbility(ac, policyFor(actor)), env)`.

Hiding a control is a courtesy, not protection: the server still checks every action, with [the guard](./guard.md) or [`where`](./where.md).

## Why it works this way

- **A factory, not a global import.** Typed bindings need your `ac`, and a module-level import cannot receive it.
- **`useAbility` throws without a provider.** A deny-everything default would look like a policy decision and hide the wiring mistake.
- **Two entry points**, because `"use client"` marks a whole module: the server `<Can>` lives at `@vetojs/react/server`, so a server component never turns into a client one to hide a button.
- **The client `<Can>` also takes `ability`.** Passed, it ignores the context; with neither it throws instead of assuming.

## Source

[`context.ts`](../packages/react/src/context.ts) · [`types.ts`](../packages/react/src/types.ts) · tests: [render](../packages/react/tests/render.test.ts), [context](../packages/react/tests/context.test.ts), [provider](../packages/react/tests/provider.test.ts)
