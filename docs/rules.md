# What a rule is

**[English](rules.md) · [Русский](rules.ru.md)**

A rule is one sentence of policy: *allow (or deny) this action on this resource, for these rows, over these fields.* Rules are plain JSON objects — that is the central design choice of the library. They serialise, travel from server to client, get stored in a database, and are edited by a UI without ever becoming code.

A policy is then just a function:

```ts
const policyFor = (actor: User): CheckedRules => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: actor.id } }),
	deny("update", { post: ["featured"] }),
];
```

No class, no builder, no hidden state — a pure function from actor to data.

## The shape

```ts
type Field<T> = Exclude<keyof T & string, "">;

type Rule<T = Record<string, unknown>> = {
	effect: "allow" | "deny";
	action: string | [string, ...string[]];
	resource: string;
	where?: ConditionNode<T>;
	fields?: readonly [Field<T>, ...Field<T>[]];
	values?: FieldConditionNode<Partial<T>>;
};
```

| Field | Meaning |
|---|---|
| `effect` | `allow` or `deny`. A deny always wins — see [rule evaluation](./rule-evaluation.md) |
| `action` | one action, a non-empty list, or `"manage"` for all of them |
| `resource` | which resource this is about |
| `where` | **which rows** the action may touch |
| `fields` | **which fields** may be written — at least one, each a non-empty string key of the shape |
| `values` | **which values** those fields may take |

## `where` and the write levels answer different questions

This split is the thing to internalise:

- `where` — *may I touch this row at all?* Checked against the row as it exists in the database.
- `fields` and `values` — *may I write this?* Checked against the incoming data.

"Bob may edit his own posts" is a `where`. "Bob may edit the title but never the `featured` flag" is `fields`. "Bob may set status, but only to `draft`" is `values`. Conflating them produces rules that look right and enforce the wrong thing — [mutations](./mutations.md) walks through the combinations.

## Rules as data

Because a rule is JSON, it survives a round trip:

```ts
const wire = JSON.stringify(policyFor(actor));
const parsed = parseRules(JSON.parse(wire)); // validated at the boundary
```

Values inside rules stay JSON-native — a `Date` is stored as epoch milliseconds by the shorthand compiler, so nothing is lost in transit. See [parse](./parse.md) for what happens to untrusted rule JSON, and [condition shorthand](./condition-shorthand.md) for how values are encoded.

## Why it works this way

- **`where`, `fields` and `values` are separate keys, not one merged condition.** The structure itself prevents writing a row-constraint where a value-constraint was meant.
- **`values` is typed over a partial shape**, because a PATCH sends only the fields it changes. Only the keys actually present in the data are checked.
- **The default type is `Record<string, unknown>`, not `any`.** Rules deserialised from a database stay usable without leaking `any` into your code; a typed `Rule<Post>` narrows `where`, `fields` and `constraints` to the resource.
- **`"manage"` opens to the future.** It grants every action the resource declares *at the moment of the check*, so an action added to `defineAbilities` later is granted to everyone already holding it. That is usually what "this role owns the resource" means. When a grant should be a snapshot of today — a policy transcribed from a list of permissions the backend hands out, where a new action is not granted by the model learning about it — write the list instead:

```ts
allow("manage", "post");            // every action post has, now and later
allow([...ac.post.actions], "post"); // the actions post has today
```

- **`"manage"` is a plain string, not a special type.** Its meaning is given by rule matching, so a policy stored as JSON needs no special encoding.
- **`"manage"` is written in a rule, never asked.** A question names the action it means: `can("manage", "post")` does not compile, and one that gets past the types is refused. Asked, it could only say whether some rule reads `manage` — yes for an owner denied `delete`, no for someone granted every action one by one.
- **A list names at least one action.** An empty one matches nothing, so an `allow` would grant nothing and a `deny` would protect nothing while looking like a prohibition. The compiler refuses it, in `allow` and `deny` and in the `Rule` type, and `parseRules` refuses one that arrives as JSON, the same as an empty field list.
- **A field is named by a non-empty string.** A write carries its keys as strings, so a numeric or symbol key of the shape cannot be named in a rule — it would never match — and neither can an empty one. `parseRules` refuses an empty field name, as it refuses an empty action or resource name.

## Source

[`model/rule.ts`](../packages/core/src/model/rule.ts) · [tests](../packages/core/tests/model/rule.test.ts)
