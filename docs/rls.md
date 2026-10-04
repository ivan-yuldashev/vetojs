# Running alongside Postgres row-level security

**[English](rls.md) · [Русский](rls.ru.md)**

RLS and this library answer different halves of the same question. Postgres decides **which rows a connection may see**. Veto decides that too — plus which fields may be written, what the UI may render, and what an agent's tool call may touch. Using both is reasonable; assuming either one covers the other is not.

## What each half can do

| | RLS | veto |
|---|---|---|
| Which rows a query returns | ✅ enforced by the database | ✅ compiled into `WHERE` |
| Which fields may be written | ✖ `GRANT UPDATE (col)` binds to a role, not to an actor or a row | ✅ `fields` and value constraints |
| Gating the UI | ✖ nothing crosses to the browser | ✅ rules ship as JSON |
| A resource with no table | ✖ nothing to attach a policy to | ✅ an ordinary rule |
| Anything but Postgres | ✖ | ✅ |

The pairing that makes sense: **RLS as the floor, veto as the contract.** The database refuses to hand out rows even if a query forgets its filter; the application still answers *why* and refuses writes field by field.

## Three ways to believe you are protected when you are not

**The table owner bypasses RLS.** Enabling row security does nothing for the role that owns the table — and application connections are frequently the owner. The symptom is the worst kind: every query returns every row, silently.

```sql
alter table posts enable row level security;
alter table posts force  row level security;
```

Without `force`, an owner connection sees everything.

**A session setting outside a transaction is not scoped to anything.** `SET LOCAL` lives for the current transaction; plain `SET` lives for the connection, which behind a pooler is the next request's connection too. Set the actor per transaction, and read it in the policy:

```sql
begin;
set local "veto.actor" = 'u1';
-- queries here
commit;
```

**Policies are OR-ed by default.** Every `PERMISSIVE` policy you add *widens* access. That is the opposite of a deny-override model: a prohibition has to be written `AS RESTRICTIVE`, and one forgotten keyword turns a deny into a no-op.

## Writing the policy expression

The condition veto compiles is already the shape `USING` wants — total, never `NULL`, with relations as `EXISTS` — but it is built for *one actor*, with the actor's values bound as parameters. A policy is DDL and has no actor, so the value has to come from the session instead:

```
using ("posts"."author_id" is not distinct from current_setting('veto.actor', true))
```

That substitution is the whole difference, and it is why a policy generator needs templated rules rather than the per-actor ones we build today.

## What this costs you

A policy is DDL, generated once. The application's rules are code, deployed continuously. **They drift**, and nothing tells you — the conformance guarantee this library rests on (`filter` selects exactly what `can()` allows, proven per query) becomes "the installed policy matches the code", which is a migration problem rather than a test.

So: use RLS as a floor that catches the query you forgot, keep the policy in one place, and do not maintain two sources of truth for the same rule if you can avoid it.

## Why it works this way

- **The database is the only place a forgotten filter cannot leak.** That is worth having even when the application is careful.
- **Field-level and UI-level rules have no database equivalent**, so removing veto from the stack removes those two, not just some duplication.
- **Two-valued predicates are not optional here either.** A `NOT` over a `NULL` in a `USING` expression silently flips a row's visibility — the same class of bug the [Drizzle adapter](./drizzle.md) refuses to emit.

## Source

[filtering in the database](./where.md) · [the Drizzle adapter](./drizzle.md) · [writes](./mutations.md)
