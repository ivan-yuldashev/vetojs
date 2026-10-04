# Documentation

**[English](README.md) · [Русский](README.ru.md)**

One page per concept, each describing how the shipped code behaves and ending with why it works that way. New here? Start with the [project README](../README.md).

## Agents

- **[Guarding what an agent does](./agents.md)** — tool calls under the person's policy, refusals a model can act on, narrower rights for the agent, tools with no table.
- **[For agents](./for-agents.md)** — the whole API on one page, for an assistant writing code with veto.

## A policy

1. **[Declaring resources](./define-abilities.md)** — `defineAbilities`, the request's environment, resources with no rows.
2. **[Rules](./create-rules.md)** — `createRules`: `where`, `fields`, `values`, `when`, and the stored JSON form.
3. **[Checking access](./ability.md)** — `buildAbility`, `withEnv`, `onDecision`.

## Conditions

- **[Conditions](./conditions.md)** — the shorthand, operators by field type, comparing two fields, the stored tree.
- **[Operators](./operators.md)** — what each answers on messy data.
- **[Relations](./relations.md)** — conditions across related resources, and loading them.

## Enforcement

- **[How a decision is made](./rule-evaluation.md)** — deny wins, default deny, unknown never grants.
- **[Writes](./mutations.md)** — `canMutate` and `validatePayload`.
- **[Filtering in the database](./where.md)** — `where()` selects exactly what `can()` allows.
- **[Rules from outside](./parse.md)** — `parseRules` at the trust boundary.

## In an app

- **[The guard](./guard.md)** — `createGuard` for server actions, HTTP handlers and tool calls.
- **[HTTP handlers](./http.md)** — Express, Fastify, Hono.
- **[`@vetojs/react`](./react.md)** — `<Can>`, `useCan`, `useAbility`, server components.
- **[Server rendering](./ssr.md)** — rules across the boundary, and why a static page carries no verdict.
- **[`@vetojs/drizzle`](./drizzle.md)** — the policy as a SQL `WHERE`.
- **[Postgres RLS](./rls.md)** — running both, and three ways RLS protects nothing.
- **[Migrating from CASL](./migrate-from-casl.md)** — the API mapped across, and the behaviour that differs.
