# @vetojs/core

## 0.11.1

### Patch Changes

- 53c20be: **Checks are two to five times faster, with the same answers.**
  
  Rules are grouped by resource and action the first time that pair is asked about, a `where` is compiled into a function on first use, and a check stops as soon as its verdict is fixed — at the first grant when the pair carries no prohibition.
  
  Measured on the benchmark that compares both engines, published bundle against published bundle: against a 222-rule policy one check goes from 90k to 549k a second when nothing matches, and from 83k to 515k when the matching rule sits last; on a twelve-rule policy a miss goes from 1.7M to 4.2M and a match from 1.7M to 2.7M.
  
  Building an ability now takes a copy of the policy, so the rules are read once: changing the array or a rule object afterwards no longer changes some answers and not others. Building a 222-rule policy on its own drops from 10M a second to 5M; a build followed by a check is unchanged, the copy being smaller than the first grouping. Nothing is grouped or compiled until something is asked.
  
  The relations a policy reads are gathered per resource and action, and a check reads them once before weighing any rule. A forgotten `include` therefore raises `RelationNotLoadedError` whatever the order of the rules and whichever rule would have settled the row — including when a `deny` settles it.
  
  The cost is 0.7 kB gzipped: a check with trusted rules bundles at 3.8 kB rather than 3.1.

## 0.11.0

### Minor Changes

- c3a0de4: **A refusal now says where it happened.**
  
  `ability.validate` keeps the path the schema blamed, instead of handing you a message with no field attached:
  
  ```ts
  const result = ability.validate("post", input);
  // { ok: false, issues: [{ message: "expected string", path: ["authorId"] }] }
  ```
  
  `path` follows Standard Schema, so nested fields arrive as `["meta", "views"]` and array indices as `["tags", 0]`. It is absent when the schema blamed the value as a whole.
  
  **Two refusals that never reached the rules are now visible.**
  
  When `load` comes back with nothing — a `findFirst` that matched nothing, an id belonging to someone else — the guard's decision carries `reason: "no row"`, which reads differently in a log from a policy saying no. When nobody is signed in there is no actor, so no policy and no decision; `onUnauthenticated` now receives `{ action, resource }`, making it the place to record an attempt without a session:
  
  ```ts
  onUnauthenticated: ({ action, resource }) => {
  	log.warn({ action, resource, outcome: "no session" });
  	throw new Response(null, { status: 401 });
  },
  ```
  
  **`load` may say it found nothing.** Its return type accepts `null` and `undefined`, so a loader that returns `Post | undefined` no longer needs a cast. `ctx.row` stays a row rather than a maybe-row: reaching your handler is proof one was found.
  
  An empty `violations` array is documented for what it is — a write refused as a whole, with no field left to name — rather than looking like an absence of problems.
- fb3edee: **`schema` is optional now.**
  
  A resource that has no rows behind it — a screen, a report, a background job — is declared without one:
  
  ```ts
  const ac = defineAbilities({
  	resources: {
  		post: { schema: shape<Post>(), actions: ["read", "update"] },
  		report: { actions: ["view", "export"] },
  	},
  });
  ```
  
  It stays a resource in every other way: its own actions, ordinary rules, and `can("view", "report")` answering from them. What changes is the shape, which is empty — so a row cannot be passed by mistake and no condition can compare a field the resource never had. `ability.validate` still accepts any object and refuses anything else, and a resource nobody declared is still refused as unknown.
  
  Declaring `schema: shape<Record<string, never>>()` to say the same thing is no longer needed.

## 0.10.0

### Minor Changes

- 4be5eeb: **`CheckedRule` is exported again.**

  `0.7.0` dropped it as unreachable. It is not: a table typed as permission → rule needs the singular, and `CheckedRules[number]` is a workaround for a name that should simply be there — `Rule` is exported and its checked sibling was not.

  ```ts
  const byPermission: Record<string, CheckedRule> = { … };
  ```

- 4be5eeb: **`shape()` replaces `type()`, which is now deprecated.**

  `type` collides with the TypeScript modifier of the same name, so a real import line reads like a typo and import sorters order it differently between runs:

  ```ts
  import {
    type CheckedRules,
    createRules,
    defineAbilities,
    type,
  } from "@vetojs/core";
  ```

  `shape` is the same function under a name that cannot be confused with syntax:

  ```ts
  import {
    type CheckedRules,
    createRules,
    defineAbilities,
    shape,
  } from "@vetojs/core";

  const ac = defineAbilities({
    resources: { post: { schema: shape<Post>(), actions: ["read"] } },
  });
  ```

  `type` stays exported and keeps working; rename whenever it suits you.

### Patch Changes

- b2e7ab2: **The npm descriptions say what each package does.**

  `@vetojs/core` no longer claims to compile SQL by itself — the rules become a `WHERE` clause through the Drizzle adapter — and now names what it does do on its own: answer `can()`, gate writes field by field, and guard a server action, an HTTP handler or an agent tool call.

  `@vetojs/react` names the server `<Can>`, which decides while rendering with no client boundary and no hooks.

## 0.9.0

### Minor Changes

- edb18ec: **A payload decision now tells the hook which field it refused.**

  `onDecision` reported a payload refusal as `allowed: false` and nothing more, so a log could not tell an attempted field substitution from an ordinary denial. The report now carries the same `violations` the call returns:

  ```json
  {
    "action": "update",
    "resource": "post",
    "allowed": false,
    "violations": [{ "field": "authorId", "reason": "field not permitted" }]
  }
  ```

  `field not permitted` says someone wrote a field they do not own; `value not permitted` says the field was theirs and the value was not. Decisions about rows carry no `violations`, because a refusal there is settled by a rule rather than field by field.

## 0.8.0

### Minor Changes

- 51fc969: **Every decision can now be recorded, with the rule that settled it.**

  ```ts
  const ability = buildAbility(ac, policyFor(currentUser), {
    onDecision: (decision) => {
      log.info({ actor: currentUser.id, ...decision });
    },
  });
  ```

  The report carries the `action`, the `resource`, whether it was `allowed`, and the `rule` that decided — the `deny` that fired or the `allow` that granted. There is no `rule` when nothing matched and the default denied, which is the case worth alerting on: the policy said nothing about a question someone asked.

  A payload decision carries no `rule` — a refusal there is per field, and the `violations` you get back name the field and the reason. It fires for `can`, `cannot`, `authorize`, `canMutate` and `validatePayload`, once per call, and not for `where`, `permittedFields` or `validate` — those ask what a policy says rather than whether an actor may act. The verdict is decided before the hook runs, so nothing it does can change an answer; whatever it throws reaches your caller untouched.

  `createGuard` takes the same hook with the actor as a second argument, because it is configured once while the actor is resolved per call.

  The rule is recorded where it fires, so a decision with a hook costs 4-8% more than one without and a decision without a hook costs what it always did. The browser bundle grows by 130 bytes gzipped.

## 0.7.0

### Minor Changes

- a8c2bba: **`ctx.row` and `ctx.payload` are optional only when the action left them out.**

  Give the action a `load` and the handler gets a row, not a row-or-`undefined`:

  ```ts
  const publish = withPermission(
    { action: "publish", resource: "post", load: (id: string) => loadPost(id) },
    async (ctx) => ctx.row.title
  );
  ```

  `ctx.payload` narrows the same way from `payload`. An action with neither keeps `undefined` in the type, because that is what the handler receives.

- a8c2bba: **The guard is now `@vetojs/core/guard`, and it is not tied to Next.js.**

  ```ts
  import { createGuard } from "@vetojs/core/guard";

  export const withPermission = createGuard({
    ac,
    getActor,
    policy: policyFor,
  });
  ```

  The same wrapper guards a server action, a Hono or Express handler, and an MCP tool call — see [the guard](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.md), [HTTP handlers](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/http.md) and [agents](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/agents.md).

  `@vetojs/next` re-exports `createGuard` from its new home and is no longer maintained; move the import when convenient.

  `@vetojs/core/internal` is gone. It carried the pieces `@vetojs/next` needed to build the guard, which core now does itself.

- a8c2bba: **Two types are no longer exported: `RelationNode` and `CheckedRule`.**

  Neither was reachable in practice. `RelationNode` named one of the five shapes `ConditionNode` can take, and the other four were never exported — even the Drizzle adapter narrows with `Extract<ConditionNode<…>, { relation: string }>` rather than naming it. `CheckedRule` is the singular of `CheckedRules`, which stays.

  Nothing changes in what you can write: `allow()` and `deny()` return the same values, conditions have the same shape, and both types are still inferred wherever they appear. If you named one explicitly, use `Extract<ConditionNode<T>, { relation: string }>` or `CheckedRules[number]`.

### Patch Changes

- 275a6f0: **A payload constraint that is not flat now says so.**

  `payload.constraints` takes a field condition or an `and` of them. Given an `or`, a `not` or a `relation`, `parseRules` used to report the field it could not find:

  ```
  rules[0].payload.constraints.field: expected a string
  ```

  It now names what it refused:

  ```
  rules[0].payload.constraints: "or" is not allowed in payload constraints — they take a field condition or "and"
  ```

  The rules accepted are unchanged; "this value is forbidden" is still a `deny` rule rather than an expression buried in a constraint.

## 0.6.0

### Minor Changes

- 7e4bcc3: **`parseRules` rejects a node that carries more than one shape.** Such a node used to pass the gate, and every reader then answered the first shape it recognised and silently discarded the rest.

  ```ts
  where: {
  	field: "views",
  	op: "gt",
  	value: 100,
  	and: [{ field: "id", op: "eq", value: "p1" }],
  }
  ```

  The engine looks for `and` first, so `views > 100` was never evaluated. In an `allow` that grants more than the rule says: a row with `views: 5` passed.

  A rule's `payload.constraints` had the same hole. The mutation gate collects the `and` group and drops the field constraint beside it, so `validatePayload` accepted `status: "published"` under a rule permitting only `"draft"`.

  Neither needed a cast — a policy loaded from a database or an admin UI reached both through the ordinary path. Rules built with `createRules` were never affected: sibling keys in the shorthand compile into a proper `and` group. If your stored JSON contains such a node, `parseRules` now returns `ok: false` naming both shapes, and the fix is to nest the field condition inside the group where it was meant to be.

### Patch Changes

- bad0f7f: **An operator the engine does not recognise now answers `undefined` instead of `false`.** `false` read the same in both effects: an `allow` granted nothing, but a `deny` also did nothing — so an unrecognised operator inside a `deny` handed back a row the rule was written to hide.

  ```ts
  deny("read", "post", {
    where: { field: "secret", op: "bogus", value: true },
  });
  ```

  The row used to pass. It is now hidden, matching how the engine already answers a relation quantifier it does not recognise: unknown grants nothing and denies everything it touches.

  `parseRules` rejects an unrecognised operator, so this only reaches the engine when rules are cast past the gate — the same reach as the quantifier fix in 0.5.1, and the same patch-sized blast radius.

## 0.5.1

### Patch Changes

- 7a579b2: **A relation quantifier the engine does not recognise is now unknown, not a miss.**

  A to-many condition whose `match` is something other than `some`, `every` or
  `none` used to answer "no match". An `allow` written that way granted nothing,
  which was right, but a `deny` written that way went silent — the prohibition
  never fired and the row stayed visible. It now answers unknown, so the `allow`
  still grants nothing and the `deny` fires, in line with every other shape the
  engine cannot decide.

  Rules built with `createRules` cannot carry such a quantifier, and `parseRules`
  rejects one, so this only reaches the engine when rules are cast past both
  gates. If yours are, a `deny` you thought was doing nothing may now start
  refusing rows.

## 0.5.0

### Minor Changes

- ef88203: `@vetojs/core` is now a peer dependency of `@vetojs/react`, and `ForbiddenError.is()` recognises a refusal without relying on class identity.

  `@vetojs/react` used to depend on `@vetojs/core` normally, so upgrading core past the range react was published against installed a second copy rather than reporting a mismatch. Two copies interoperate almost everywhere — rules are plain data — which is what made the one failure quiet: `ForbiddenError` gets two class identities, `error instanceof ForbiddenError` answers `false` for a valid refusal, and a 403 turns into a 500. As a peer dependency the mismatch surfaces at install time instead.

  Install core alongside the bindings:

  ```sh
  npm install @vetojs/react @vetojs/core
  ```

  `ForbiddenError.is(error)` matches on a registered symbol, so it also holds where a duplicate copy does slip through:

  ```ts
  try {
    ability.authorize("delete", "post", post);
  } catch (error) {
    if (ForbiddenError.is(error)) {
      error.violations;
    }
  }
  ```

  `instanceof` still works when there is one copy, and nothing else about the error changed.

## 0.4.0

### Minor Changes

- 30f72a2: **Added `has` / `hasAny` / `hasAll` for array fields.**

  ```ts
  allow("read", "doc", { where: { tags: { has: "urgent" } } });
  allow("read", "doc", { where: { roles: { hasAny: ["admin", "owner"] } } });
  allow("read", "doc", {
    where: { roles: { hasAll: ["billing", "support"] } },
  });
  ```

  Until now an array field had no usable operator: `eq` and `in` compared the array as a whole, which is never equal by reference, so such a rule answered unknown for every row — granting nothing and firing every `deny`. A `roles: string[]` column had no way to ask the obvious question.

  An absent field is a decidable miss. A present non-array answers unknown, so a wrong shape cannot decide in either direction. An empty `hasAll` is satisfied by any array, but not by an absent field.

  **Breaking at compile time: a field is offered only the operators that can answer something about it.**

  An array of scalars takes `has` / `hasAny` / `hasAll` and `exists`. Anything non-scalar — a nested object, an array of objects — takes only `exists`; model it as a relation if you need to match inside it.

  What stops compiling is `eq` on an object field and `eq` or `in` on an array. Those rules answered unknown for every row, so no working policy changes. Runtime behaviour is untouched, including scalars, `Date` and the `number` / `bigint` bridge.

## 0.3.0

### Minor Changes

- 23e9272: **Fixed: a `deny` on an object-valued field no longer fails open.**

  Equality fell through to `===` for two objects, and structurally identical objects are never the same reference. The engine read that as a _decidable_ non-match, so a prohibition like this applied to nothing:

  ```ts
  deny("read", "doc", { where: { meta: { eq: { classified: true } } } });
  // row { meta: { classified: true } } → can() === true
  ```

  An `allow` written that way merely granted nothing, which is harmless. A `deny` was dead for every row, whatever it held.

  `eq` / `ne` / `in` / `nin` now answer **unknown** whenever either operand is an object or an array — the same verdict a present value of the wrong type already gets, and the one that fails closed in both directions: an `allow` grants nothing, a `deny` fires. The comparison is undecidable rather than merely awkward, so this holds even when both sides are the very same reference; that case cannot survive `JSON.stringify` → `parseRules`, the documented path rules travel, so nothing that worked across the wire changes.

  Scalars, `Date` (still compared by timestamp, including against epoch milliseconds) and the `number` / `bigint` bridge are untouched. Database adapters already refuse to compile an object comparison, so the engine and your SQL stay in agreement: one denies, the other declines to build the query.

  If you need to match inside a nested object, model it as a relation — the engine compares scalars.

  **Changed: adapter-facing exports moved to `@vetojs/core/internal`.**

  ```ts
  import {
    isPayloadScoped,
    isPlainObject,
    ruleMatches,
  } from "@vetojs/core/internal";
  ```

  These let an adapter or a guard inspect a policy without evaluating it; an application calls none of them. Keeping them on the main entry promised semver stability to callers who will never appear, and hid the one adapters actually need — the predicate deciding whether a `deny` speaks about data or about rows.

  **Breaking:** `ruleMatches` is no longer exported from `@vetojs/core`. Import it from the subpath instead. Nothing else moved. The subpath carries no stability promise across minor versions — that is what the name is for.

## 0.2.0

### Minor Changes

- 6e5c998: Fix: a `deny` that names payload fields or constraints no longer blocks the row.

  `deny(action, resource, { payload: { fields: [...] } })` reads as "this field may not be written". `permittedFields` and `validatePayload` already treated it that way, but `evaluateRules` and `compileWhere` ignored `payload` entirely — and a `deny` with no `where` matches every row. The rule therefore vetoed the action outright: `can` and `canMutate` returned `false` for every row, `where()` compiled to a filter matching nothing, and the documented `canMutate` → `validatePayload` order never reached the field check.

  All four now share one predicate. A `deny` is payload-scoped when it names `payload.fields` or `payload.constraints`; such a rule settles in `validatePayload` and leaves the row decision alone, and a `where` on it scopes which rows the field restriction covers. A `deny` naming neither — including one carrying an empty `payload: {}` — remains a prohibition on the action itself, unchanged.

  The conformance suite gained payload-carrying cases; it had none, which is why the `can()` / `where()` divergence went unnoticed.

  The old behaviour only ever denied more than intended, so no policy becomes more permissive than its author wrote.

- f303ea8: Fix: `validatePayload` no longer passes empty data on a row no `allow` covers.

  `validatePayload` only ever objected to keys it found in `data`, so `{}` gave it nothing to object to and it answered `{ ok: true }` — even for a row the actor may not write at all. `permittedFields` already returned `[]` in that situation; the two disagreed.

  It now refuses outright when no `allow` applies to the row, matching `permittedFields` and `canMutate`. Non-empty data was already refused, so only the empty-payload path changes.

  Callers following the documented `canMutate` → `validatePayload` order were never exposed, since the row gate ran first. The risk was in treating `validatePayload` as the whole check — which its signature invites, because it takes the row.

## 0.1.0

### Minor Changes

- 355ca26: First public release.

  `@vetojs/core` — the engine: `defineAbilities`, `createRules`, `buildAbility`, `parseRules`, ten condition operators, relations with a loaded-relation contract, the write gate (`canMutate` / `validatePayload` / `permittedFields`), and `where()` for compiling a policy into a database filter. Zero runtime dependencies.

  `@vetojs/react` — `createVetoContext(ac)` returning `<Can>`, `useAbility` and `AbilityProvider`, typed per resource.
