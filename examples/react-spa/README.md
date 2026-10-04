# react-spa — a gated UI from JSON rules

`@vetojs/react` without Next.js. The actor's policy is serialized to JSON exactly as it would travel over the network, validated on arrival, and drives the whole interface.

```sh
pnpm --filter @vetojs-examples/react-spa dev
```

Switch between three actors — alice (admin), bob (editor), carol (viewer here, editor of an archived workspace) — and the routes, links and buttons re-derive from the freshly delivered rules.

## What it shows

**Typed bindings from one factory.** [`src/authz.ts`](./src/authz.ts) calls `createVetoContext(ac)` once and re-exports `Can` / `useAbility` / `AbilityProvider`; everything else imports from there and gets per-resource typing.

**Gating by instance.** `<Can I="update" a="post" this={post} fallback={…}>` — bob's *edit* appears only on his own posts; carol's nowhere, for two different reasons (viewer in one workspace, archived-workspace deny in the other).

**Lists filtered by policy**, including conditions beyond simple equality: a trending draft becomes readable through `views: { gte: 100 }`, and a post with unmoderated spam is locked for editing via `comments: { some: { spam: true } }`.

**Route protection, two ways.** Hiding a nav link is UX — the route still guards itself. `/posts/:id` and `/posts/:id/edit` answer with a 403 panel through the same ability that hid the link; `/workspaces/:id/settings` redirects instead. Deep-linking to a forbidden URL is covered either way.

**A tampered batch, turned away at the door.** The panel also parses a rule carrying an operator that does not exist. `parseRules(json)` refuses the whole delivery and names the path that failed — the engine never sees a rule the gate could not read. Names are a different question: the gate checks shape, and rules have to come from the same generation as the build reading them.

**Forms driven by `permittedFields`** — bob sees `title` and `status` as editable. Whether a particular *value* is allowed is enforced on the server, as the next-app demo shows.

**A resource with no data.** `analytics` is a screen, not a table: its instance is synthesized from the URL and gated by an ordinary rule.

The raw rules JSON is shown at the bottom of the page — that array is the entire thing that crossed the boundary.
