# Writes — rows, fields and values

**[English](mutations.md) · [Русский](mutations.ru.md)**

A write asks two questions: may this actor touch the row, and may they write this data.

```ts
if (!ability.canMutate("update", "post", row)) {
	throw new ForbiddenError("update", "post");
}

const result = ability.validatePayload("update", "post", row, data);

if (!result.ok) {
	return badRequest(result.violations); // [{ field, reason }]
}

await db.update(posts).set(result.data).where(eq(posts.id, row.id));
```

Write `result.data`, the validated copy. [The guard](./guard.md) runs both steps before your handler.

## `canMutate` — the row

The same decision as `can` with a row. Without a row — a create — it passes only when an `allow` with no `where` covers the action and no `deny` reads the row.

## `validatePayload` — the data

```ts
ability.validatePayload(action, resource, row, data);
// → { ok: true, data } | { ok: false, violations: [{ field, reason }] }
```

It takes the row because which rules apply depends on it: a rule covering drafts does not constrain a write to a published post. A row no `allow` covers is refused, even with empty data. A create passes `undefined` as the row; the field and value rules still answer, and an `allow` conditioned on rows grants nothing.

Only keys present in `data` are checked, so a PATCH sends only what it changes. Nothing is stripped silently — every refused key is reported:

| `reason` | when |
|---|---|
| `field not permitted` | no applicable `allow` names the field, or a `deny` does |
| `value not permitted` | the field has `allow` value constraints and the value meets none of them |
| `value denied` | the value meets a `deny` value constraint |

```ts
allow("update", { post: ["title", "status"] }, {
	where: { authorId: actor.id },
	values: { status: { in: ["draft"] } },
});

// { title: "New title" }  → ok
// { status: "draft" }     → ok
// { status: "published" } → status: value not permitted
// { featured: true }      → featured: field not permitted
```

An empty `violations` list is still a refusal: the write was turned down whole, by a `deny` with no fields or values, or for want of an `allow`.

## Answering an agent

A model that reads the refused field fixes its argument instead of repeating the call. Return the violations as the tool's result:

```ts
const result = ability.validatePayload("update", "post", row, data);

if (!result.ok) {
	return {
		isError: true,
		content: [{ type: "text", text: result.violations.map((v) => `${v.field}: ${v.reason}`).join("; ") }],
	};
}
```

[Guarding what an agent does](./agents.md) wires this into a tool call.

## Why it works this way

- **One violation per field** — the first, most specific reason.
- **A `deny` with no `fields` or `values` vetoes the whole write**, so sending only permitted fields cannot get around it.
- **A `deny` with `fields` or `values` speaks about data, not rows.** It removes fields or values from what may be written and leaves `can` and `canMutate` alone; read as a row rule, "never this field" would mean "never this action".
- **On a `deny`, `fields` and `values` do not combine.** A field listed in `fields` is removed whatever it carries; write a forbidden value with `values` alone.

## Source

[`api/mutation.ts`](../packages/core/src/api/mutation.ts) · [tests](../packages/core/tests/api/mutation.test.ts)
