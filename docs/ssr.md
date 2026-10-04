# Server rendering

**[English](ssr.md) · [Русский](ssr.ru.md)**

Rules are JSON, so they cross from server to client in whatever the framework already uses to ship data. No adapter is needed:

```tsx
const ability = buildAbility(ac, policyFor(currentUser));

<AbilityProvider rules={ability.rules}>
	<Toolbar post={post} />
</AbilityProvider>
```

| Framework | Where the rules cross |
|---|---|
| Next, App Router | a server component renders the provider; the module calling `createVetoContext` is a `"use client"` module |
| SvelteKit | `+layout.server.ts` returns them, child routes read `data` |
| React Router | a `loader` returns them, `useLoaderData()` reads them |
| Nuxt | a route middleware seeds `useState("rules", …)` from the server context |
| Astro | the page passes them to an island as props |

```ts
// +layout.server.ts
export const load = ({ locals }: { locals: { user: { id: string } } }) => ({
	rules: policyFor(locals.user),
});
```

## What crosses

- **Send the rules.** They are already scoped to one actor.
- **Keep the sources on the server** — the session, the memberships, the claims that produced the rules.
- **Treat the rules as visible.** A curious user will read them, so a rule carrying a workspace id they cannot otherwise see is a leak.

## Static pages carry no verdict

A statically generated page has no actor: a verdict baked into it is about nobody, and once a CDN caches it, about everybody. Render a public shell and gate after hydration, or gate at the edge, where the request has an actor. Never bake one user's rules into a page others receive.

## The server checks anyway

Hiding a control is a courtesy; the request it hides can still be sent by hand. Check before acting — with [the guard](./guard.md), or `ability.cannot(...)` in a loader or a server component.

## Why it works this way

- **Rules are data, not an object**, so they survive a serialization boundary; a class instance would not.
- **One array on both sides**, built once, read in two places — nothing to drift apart.

## Source

[`api/ability.ts`](../packages/core/src/api/ability.ts) · [React bindings](./react.md) · [the guard](./guard.md)
