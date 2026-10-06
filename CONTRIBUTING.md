# Contributing

Thanks for taking the time. This page is short on purpose — everything here is something the CI will check anyway.

## Getting set up

Node 22.11+ and pnpm 10.

```sh
pnpm install
pnpm test
```

No build needed first: inside the workspace `@vetojs/core` resolves to its source, so every package tests against the working tree rather than the last `dist/`. The one exception is `readme-size.test.ts`, which measures the bundle the README advertises — it fails with a message until `pnpm build` has run.

## The checks

```sh
pnpm test        # vitest, all packages
pnpm typecheck   # tsc across the workspace
pnpm check       # biome — formatting and lint
pnpm knip        # unused exports

pnpm check:packaging  # publint + are-the-types-wrong, on what npm would receive
```

CI runs the tests on Node 22 and 24 and the rest once, along with the React tests against React 18. `pnpm test:coverage` is there when you want the numbers, `pnpm type-bench` when you want the inference cost of the public types, `pnpm bench:casl` when you want the speed comparison the README quotes.

To run one package's tests, either form works:

```sh
pnpm vitest run --project @vetojs/core
pnpm --filter @vetojs/core test
```

## Conventions worth knowing

**No comments in source.** The reasoning lives in [`docs/`](./docs/README.md) instead — one page per concept, each ending in a "why it works this way" section. If a change needs explaining, explain it there. Functional directives (`@ts-expect-error`, `biome-ignore`, `"use client"`) are of course fine.

**Docs are bilingual.** Every page in `docs/` has an English and a Russian version (`x.md` and `x.ru.md`), linked to each other. Change one and the other needs the same change. If translating isn't practical for you, say so in the PR — that's better than a silent divergence.

**Tests before behaviour.** The engine decides who may read and write what, so behaviour changes want a test that fails without them. Look at [`conformance.test.ts`](./packages/core/tests/conformance.test.ts) for the strictest example: it asserts that the in-memory check and the compiled query agree on every row, including messy ones.

**Fail closed.** When data doesn't fit a condition, the answer is "unknown", and unknown must never grant. If a change makes an `allow` more generous or a `deny` less likely to fire on malformed input, it needs a very good reason.

**Commits describe the result, not the route.** A message is read later by someone asking what a change did to the library, so write what landed and why it matters — not the order you discovered it in. Concretely:

- A defect that existed only between commits in the same batch is **not a fix**. It is part of the change that introduced it, and belongs in that commit rather than a follow-up.
- The same goes for anything added and then reworked before it shipped: squash it, and describe the version that survived.
- Numbers earn their place only when they justify a decision a reader might otherwise reverse. "Measured X versus Y, kept X" is useful; the three attempts that produced the number are not.
- The subject line is one imperative sentence. The body is for what a reader could not infer from the diff — a behaviour change, a compatibility note, a constraint that forced the shape.

The rule of thumb: if a sentence describes what *you* did rather than what the code now *does*, it belongs in the pull request, not in the history.

## Changesets

Anything users would notice — a fix, a new export, changed behaviour — needs one:

```sh
pnpm changeset
```

Pick the packages, pick the bump, describe the change the way a user reading the changelog would want to hear it. Internal-only work (tests, refactors, CI) doesn't need a changeset.

The commit rule above applies here more strictly, because a changeset is read by people who never see this repository:

- Describe the version that ships. A shape that existed only mid-branch is not a change to anyone.
- Say what a released version did wrong only when someone might be running it. A defect introduced and closed before release never reached them.
- Keep the numbers a reader would act on — "50 re-renders against 1" tells them which hook to pick. Drop the ones that only justify the implementation.
- Leave out how it works inside. A user needs the behaviour, the migration and the edge cases; whether it uses a store, a shim or a context is ours to change later.

## Pull requests

Keep them focused, and let the description say what changed and why. If you touched behaviour, mention how you convinced yourself it's right — a test, a benchmark, a demo run.

If a change touches how conditions are evaluated or compiled, say which test covers it — [`conformance.test.ts`](./packages/core/tests/conformance.test.ts) is the one that asserts both paths agree on every row.

## Security

Please don't open a public issue for a vulnerability — see [SECURITY.md](./SECURITY.md).
