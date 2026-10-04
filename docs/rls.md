# Alongside Postgres row-level security

**[English](rls.md) · [Русский](rls.ru.md)**

Postgres RLS decides which rows a connection may see. veto decides that too, and also which fields may be written, what the interface shows and what an agent's tool call may touch. Using both is reasonable; assuming either covers the other is not.

| | RLS | veto |
|---|---|---|
| Which rows a query returns | ✅ enforced by the database | ✅ compiled into `WHERE` |
| Which fields and values may be written | ✖ `GRANT UPDATE (col)` binds to a role, not an actor or a row | ✅ `fields` and `values` |
| Gating the interface | ✖ nothing reaches the browser | ✅ rules ship as JSON |
| A resource with no table | ✖ nothing to attach a policy to | ✅ an ordinary rule |
| Databases other than Postgres | ✖ | ✅ |

The pairing that works: **RLS as the floor, veto as the contract.** The database refuses rows even when a query forgets its filter; the application decides writes field by field.

## Three ways RLS protects nothing

**The table owner bypasses it.** Application connections often are the owner, and then every query returns every row:

```sql
alter table posts enable row level security;
alter table posts force  row level security;
```

**A session setting outside a transaction leaks.** Plain `SET` lives for the connection, which behind a pooler is the next request's connection too. Set the actor with `SET LOCAL` inside the transaction:

```sql
begin;
set local "veto.actor" = 'u1';
-- queries here
commit;
```

**Policies are OR-ed.** Every `PERMISSIVE` policy widens access; a prohibition has to be `AS RESTRICTIVE`, and one forgotten keyword turns it into a no-op.

## The policy expression

The condition veto compiles is already the shape `USING` wants — never `NULL`, relations as `EXISTS` — but it carries one actor's values. A policy has no actor, so the value comes from the session:

```
using ("posts"."author_id" is not distinct from current_setting('veto.actor', true))
```

## Why it works this way

- **The database is the one place a forgotten filter cannot leak**, which is worth having even in a careful application.
- **Two sources of truth drift.** A policy is DDL applied by a migration; the rules are code deployed continuously, and nothing compares them. Keep RLS to the floor.
- **Predicates must be two-valued here too.** A `NOT` over a `NULL` in `USING` silently flips a row's visibility — the bug the [Drizzle adapter](./drizzle.md) refuses to emit.

## Source

[filtering in the database](./where.md) · [the Drizzle adapter](./drizzle.md) · [writes](./mutations.md)
