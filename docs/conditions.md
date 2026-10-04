# Conditions

**[English](conditions.md) · [Русский](conditions.ru.md)**

A rule's `where` is a small tree: comparisons at the leaves, `and` / `or` / `not` in between, and relation nodes that step into related resources. This page covers how that tree is evaluated against a row.

You normally write conditions in shorthand and never see the tree:

```ts
allow("update", "post", {
	where: {
		status: "draft",
		author: { id: actor.id },
		or: [{ views: { lt: 100 } }, { pinned: true }],
	},
});
```

Sibling keys mean **and**. The shorthand compiles to the tree below at rule-construction time, so the stored rule is plain JSON — see [condition shorthand](./condition-shorthand.md).

## The node types

```ts
type ConditionNode<T> =
	| { field: keyof T; op: ConditionOperator; value: unknown }
	| { relation: string; type: "one" | "many"; match?: MatchQuantifier; where: ConditionNode<T> }
	| { and: ConditionNode<T>[] }
	| { or: ConditionNode<T>[] }
	| { not: ConditionNode<T> };
```

| Node | Holds when |
|---|---|
| `field` | the comparison holds — see [operators](./operators.md) |
| `relation` | the related row(s) satisfy the nested condition — see [relations](./relations.md) |
| `and` | every child holds |
| `or` | at least one child holds |
| `not` | the inner node does not hold |

An empty `and` holds (nothing to violate); an empty `or` does not (nothing to satisfy). That makes `{ and: [] }` the "always" node and `{ or: [] }` the "never" node — which is how the compiler expresses *no constraint* and *impossible* respectively.

## Three states, not two

A node doesn't answer just yes/no — it can also answer **unknown** when the data is incoherent with the condition (a wrong-typed field, a corrupt relation item). The combinators propagate it the way three-valued logic requires:

| | result |
|---|---|
| `and` | **no** if any child is no; otherwise **unknown** if any is unknown; else yes |
| `or` | **yes** if any child is yes; otherwise **unknown** if any is unknown; else no |
| `not` | flips yes/no, leaves unknown alone |

The point is the last row: `not` cannot turn unknown into yes. A `deny` wrapped in a negation can't be disarmed by feeding it garbage. [Rule evaluation](./rule-evaluation.md) explains what the engine does with the final unknown.

## What can throw

Almost nothing. Evaluation is synchronous, pure, and total: unrecognised nodes and unknown operators fail closed rather than crash.

The single exception is a **relation the rule needs but you never loaded** — that throws `RelationNotLoadedError`, because silently treating missing data as "doesn't match" is how row leaks happen. See [relations](./relations.md).

## Why it works this way

- **Branches are recognised by key presence** (`"and" in node`), mirroring the type-level union. The first shape a node names wins, so a node must carry exactly one — [`parseRules`](./parse.md) refuses a node naming two, which would otherwise have half of it silently dropped. A node matching no known shape falls through to operator evaluation, and an unrecognised operator answers **unknown**: an `allow` grants nothing, a `deny` still fires.
- **All branches are evaluated, even after the answer is settled.** A `deny` whose first branch already matched still walks the rest — so an unloaded relation anywhere in the tree is reported rather than hidden by evaluation order. Diagnostics stay deterministic; the cost is a full walk of conditions that are, in practice, a handful of nodes.

## Source

[`compile/matcher.ts`](../packages/core/src/compile/matcher.ts) · [tests](../packages/core/tests/compile/matcher.test.ts) · type: [`model/condition.ts`](../packages/core/src/model/condition.ts)
