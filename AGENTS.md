# AGENTS.md

Instructions for coding agents working in this repository. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md), which this mirrors.

Generating code that *uses* Veto rather than changing it? Read [docs/for-agents.md](./docs/for-agents.md) instead.

## Setup

```sh
pnpm install
pnpm build     # required: dist/ is gitignored and the React tests import it
```

## Checks — run before claiming done

```sh
pnpm test        # vitest, all packages
pnpm typecheck   # tsc across the workspace
pnpm check       # biome, formatting and lint
pnpm knip        # unused exports — this gate fails on dead re-exports
```

To run one package's tests, go through the root. `vitest` inside a package directory finds no projects:

```sh
pnpm vitest run --project @vetojs/core   # ✓
pnpm --filter @vetojs/core test          # ✗ "No projects were found"
```

## Conventions that will trip you up

**No comments in source.** Explanations live in `docs/`, one page per concept, each ending in a "why it works this way" section. If a change needs explaining, explain it there. Functional directives (`@ts-expect-error`, `biome-ignore`, `"use client"`) are fine.

**Docs are bilingual.** Every page has `x.md` and `x.ru.md`, linked to each other and structurally parallel. Change one, change the other. The Russian is written as Russian, not translated word-for-word from the English.

**`@ts-expect-error` only suppresses the next line.** In multi-line calls the directive detaches from the error. Keep the failing call on one line.

**Types live in `.types.ts`, values in the implementation file.** The barrel (`api/index.ts`) exports values from implementation files and types from `.types.ts` — not both paths for one type, or knip will flag the dead one.

**Domain vocabulary is constants, not string literals.** `RuleEffect.Deny`, `RelationKind.One`, `MatchQuantifier.Some`, `MANAGE_ACTION` live in `model/`. Comparisons in logic use them; discriminants in type unions stay literal.

**Layering is one-directional:** `model` / `errors` ← `shared` / `verdict` / `row` ← `compile` ← `check` ← `api` ← `guard`. `create` and `validate` sit on `model` / `shared`; `api` and `guard` read `create`, and `validate` is reached only through `src/index.ts`. Nothing imports upward.

## The property that must not break

The engine decides who may read and write what, so behaviour changes need a test that fails without them.

Two invariants hold the design together:

1. **Fail closed.** When data does not fit a condition the answer is "unknown", and unknown never grants: an `allow` gives nothing, a `deny` still fires. A change that makes an `allow` more generous or a `deny` less likely to fire on malformed input is a security regression.
2. **`can()` and `where()` agree.** The in-memory check and the compiled query condition must select the same rows, including on messy data. [`conformance.test.ts`](./packages/core/tests/conformance.test.ts) asserts this; do not weaken it.

## Changesets

Anything a user would notice needs one:

```sh
pnpm changeset
```

Internal work — tests, refactors, CI — does not.

## Repository layout

```
packages/core     the engine, zero dependencies
packages/react    <Can>, useAbility, AbilityProvider
docs/             one page per concept, en + ru
```

A local tree may also carry `internal/` — design notes and maintainer scripts. The whole directory is gitignored and absent from the branch, so a clean clone will not have it. Do not add references to it from anything under `docs/`, `README*.md` or `packages/` — those links would be broken for everyone else.
