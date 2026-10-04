# Rules — `createRules`

**[English](create-rules.md) · [Русский](create-rules.ru.md)**

A rule says: allow or deny this action, on this resource, for these rows, over these fields. `createRules(ac)` returns `allow` and `deny` typed against your [declarations](./define-abilities.md), and a policy is a function of the actor returning an array of them:

```ts
import { createRules } from "@vetojs/core";
import { ac } from "./abilities";

const { allow, deny } = createRules(ac);

const policyFor = (actor: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], { post: ["title", "status"] }, {
		where: { authorId: actor.id },
		values: { status: { in: ["draft"] } },
	}),
	deny("update", { post: ["featured"] }),
];
```

`actor.id` is written into the rule as a value, so the result is plain JSON.

## What a rule can say

```
allow(action, resource,             { where, when })
allow(action, { resource: fields }, { where, values, when })
```

| Part | Answers | Checked against |
|---|---|---|
| `where` | which rows — [conditions](./conditions.md), [relations](./relations.md) | the row |
| `fields`, on the target | which fields may be written; the resource alone means all of them | the incoming data |
| `values` | which values those fields may take | the incoming data |
| `when` | whether the rule takes part in this request — [environment](./define-abilities.md#the-requests-environment) | the request |

"Bob edits his own posts" is a `where`. "Bob edits the title but not `featured`" is `fields`. "Bob sets the status, but only to `draft`" is `values`. How the last two decide a write is on [writes](./mutations.md).

`action` is one action, a non-empty list, or `"manage"`: every action the resource declares, including ones added later. Write the list out when a grant should not grow with the declaration — `allow([...ac.post.actions], "post")`. `manage` appears only in rules; a check names the action it means.

## Checked against your declarations

```ts
allow("archive", "post");                               // ✗ "post" has no "archive" action
allow("read", "posts");                                 // ✗ no such resource
allow("read", "post", { where: { bogus: 1 } });         // ✗ no such field
allow("read", "post", { where: { views: "many" } });    // ✗ views is a number
allow("read", "post", { where: { title: { gt: 5 } } }); // ✗ gt isn't for strings
```

An empty condition or an empty action list does not compile either: an empty `where` would cover every row where it meant some, and a `deny` with nothing in it would protect nothing.

## The stored form

`createRules` compiles the shorthand immediately and returns this:

```ts
type Rule = {
	effect: "allow" | "deny";
	action: string | [string, ...string[]];
	resource: string;
	where?: ConditionNode;
	fields?: readonly [string, ...string[]];
	values?: FieldConditionNode;
	when?: WhenNode;
};
```

It survives `JSON.stringify`, a database and the network unchanged. Read it back through [`parseRules`](./parse.md).

`buildAbility` takes only rules that passed a check — these factories or `parseRules` — so a hand-written literal does not compile:

```ts
buildAbility(ac, [{ effect: "allow", action: "read", resource: "post" }]); // ✗
```

A test that needs a deliberately broken rule writes `as CheckedRules`.

## One rule per role, not per tenant

Emitting the same rules once per membership makes the array grow with the tenant count, and that array crosses to the client:

```ts
// ✗ one copy of every rule per workspace
actor.memberships.flatMap(({ workspaceId }) => [
	allow("read", "post", { where: { blog: { workspace: { id: workspaceId } } } }),
]);

// ✓ one rule, naming the workspaces the role covers
const writer = actor.memberships
	.filter((m) => m.role !== "viewer")
	.map((m) => m.workspaceId);

allow("read", "post", { where: { blog: { workspace: { id: { in: writer } } } } });
```

The verdicts are the same. For an actor in 50 workspaces, 338 rules and 64 kB of JSON become 13 rules and 4 kB.

## Why it works this way

- **A policy is data.** Testing it is comparing arrays; shipping it is `JSON.stringify`.
- **`createRules` takes `ac` as a value**, because compiling `where` needs to know at runtime which keys are relations.
- **A field is named by a non-empty string.** A write carries string keys, so a symbol or numeric key could never match.

## Source

[`create/create-rules.ts`](../packages/core/src/create/create-rules.ts) · [`model/rule.ts`](../packages/core/src/model/rule.ts) · [tests](../packages/core/tests/create/create-rules.test.ts)
