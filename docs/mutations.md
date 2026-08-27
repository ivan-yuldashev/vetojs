# Writes — fields and values

**[English](mutations.md) · [Русский](mutations.ru.md)**

Checking a write is two questions, not one:

1. **May I touch this row at all?** — answered against the row already in the database.
2. **May I write *this*?** — answered against the incoming data.

Keeping them apart matters. "Bob may edit his own posts" is about the row. "Bob may edit the title but never the featured flag" is about the fields. "Bob may set the status, but only to `draft`" is about the values. A single combined check muddles all three.

```ts
if (!ability.canMutate("update", "post", row)) {
	throw new ForbiddenError("update", "post");
}

const result = ability.validatePayload("update", "post", row, data);

if (!result.ok) {
	return badRequest(result.violations);
}

await db.update(posts).set(result.data).where(eq(posts.id, row.id));
```

## `canMutate` — the row

Exactly the same decision as `can` with an instance: does an `allow` apply to this row, and does no `deny` override it. See [rule evaluation](./rule-evaluation.md).

## `validatePayload` — the data

```ts
ability.validatePayload(action, resource, row, data);
// → { ok: true, data } | { ok: false, violations: [{ field, reason }] }
```

It takes the **row** as well as the data, because which rules apply depends on the row — a rule that only covers drafts shouldn't constrain a write to a published post. A row that no `allow` covers is refused outright, empty data included: with nothing to write there is nothing to object to, and answering `ok` there would be a pass on a row the actor may not touch.

Rejections are **explicit**. Nothing is silently stripped: if a key isn't allowed you get told which one and why, so your API can answer with a real error instead of quietly saving less than the user asked for.

Only keys actually present in `data` are examined, so a PATCH is not required to send fields it doesn't change.

### Which fields

```
permitted = fields named by applicable allows − fields named by applicable denies
```

An allow that names no fields doesn't restrict them — it permits everything not denied. An incoming key outside the permitted set is reported as `field not permitted`.

For the UI-facing version of the same calculation, see `permittedFields` in [ability](./ability.md).

### Which values

For each key that passed the field check:

- matches a **deny** constraint → `value denied`;
- the field has **allow** constraints and the value satisfies none → `value not permitted`.

Allow constraints are alternatives — satisfying any one of them is enough. Deny constraints veto outright.

```ts
allow("update", "post", {
	where: { authorId: actor.id },
	payload: {
		fields: ["title", "status"],
		constraints: { status: { in: ["draft"] } },
	},
});

// { title: "New title" }      → ok
// { status: "draft" }         → ok
// { status: "published" }     → value not permitted
// { featured: true }          → field not permitted
```

Note the difference between the last two: `status` is a field Bob may write, just not to that value; `featured` he may not write at all.

## Why it works this way

- **One violation per field.** A key rejected by the field check isn't also reported as a value problem — you get the first, most specific reason.
- **A blanket `deny` vetoes the whole write**, even one carrying an otherwise-valid payload. A prohibition on the action can't be worked around by sending only permitted fields. "Blanket" means it carries no `payload` of its own.
- **A `deny` that carries a `payload` speaks about data, not rows.** It subtracts fields and values from what may be written and leaves `can` / `canMutate` untouched. Read the other way, a rule meaning "never this field" would mean "never this action", and the field restriction could never be reached — the write would already be refused a step earlier. A `where` on such a rule scopes which rows the field restriction applies to, and still doesn't decide the row.
- **On a `deny`, `fields` and `constraints` do not combine.** A field named in `fields` is subtracted outright, so a constraint over that same field is never reached. Write "this value is forbidden" with `constraints` alone; add `fields` only to forbid the key whatever it carries.
- **Value constraints stay flat** (fields and `and` only). "This value is forbidden" is a `deny` rule, not an `or`/`not` expression buried in a constraint — see [condition shorthand](./condition-shorthand.md). Flat still means one shape per node: a constraint naming a field *and* an `and` beside it is refused by [`parseRules`](./parse.md), because the reader takes the group and would drop the field. In TypeScript the other shapes never reach that check — `payload.constraints` is typed as a field condition, so `or`, `not` and `relation` are compile errors; the refusal at runtime is there for JavaScript and for a rule that arrived past the types.
- **A constraint on a field that isn't in the data is never evaluated**, which is what makes PATCH semantics work.

## Source

[`api/mutation.ts`](../packages/core/src/api/mutation.ts) · [tests](../packages/core/tests/api/mutation.test.ts)
