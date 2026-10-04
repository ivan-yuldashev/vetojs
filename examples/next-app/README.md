# next-app — all four packages on one screen

The same policy drives the SQL that fetches rows, the server-component guards, the server-action gate, and the client form. Switch actor in the header and watch every layer change together.

```sh
pnpm demo:next
```

The actor lives in a cookie (the switcher is a server action); the database is an in-memory PGlite seeded on first request, so there is nothing to set up.

## What happens on a request

**The layout** reads the actor from the cookie and renders the switcher. Every server component then calls `getAbility()`, wrapped in React's `cache()` — the policy is built once per request and shared, never cached across users.

**`/posts`** never loads a row the actor can't read: the list is fetched with `db.select().where(schema.filter(ability, "read", "post"))`, so filtering happens in the database.

**`/posts/[id]`** loads the row with its relations and guards it directly — `if (!ability.can("read", "post", post)) notFound()`. Carol deep-linking to `/posts/alice-draft` gets a 404, not a redirect that reveals the row exists.

**The edit form** is the one client subtree, and it is where the rules cross the boundary. The server passes `policyFor(actor)` down as a prop — plain JSON, no class instance, nothing to re-derive — and `<AbilityProvider>` hands it to the form. The form then asks the policy two questions the server would ask:

- `permittedFields("update", "post", post, ["title", "status", "authorId"])` decides which inputs exist at all, so the form is drawn from the policy instead of from a hand-kept copy of it;
- `validatePayload("update", "post", row, draft)` runs on every change, so a value the rule forbids is refused in the browser before anything is sent.

The form is therefore literally different per role, from one policy and no branching in the component:

| | writable fields | picking `published` |
|---|---|---|
| **bob** (editor) | `title`, `status` | refused — `constraints: { status: { in: ["draft"] } }` |
| **alice** (admin) | `title`, `status`, `authorId` | allowed, and she can hand the post to another author |

Alice gets the extra input because her `allow("manage", "post", …)` names no `payload` at all, so it restricts no field; bob's rule names `fields: ["title", "status"]`, so `authorId` never reaches his DOM.

The **submit status=published anyway** button then forges a payload past the disabled control, and the server action — wrapped in `withPermission({ action, resource, load, payload })`, consumed with `useActionState` — runs the identical check and answers with the identical violation. Forge `authorId` as bob instead and you get the other kind, `authorId: field not permitted`: fields and values are refused separately, and neither refusal depends on the form. Same rules, same call, two places: one for UX, one for the boundary.

**Shape and permission are different questions, and both reach the screen.** `post` is declared with a Zod schema rather than `type<Post>()`, so `ability.validate` does real work: the handler checks the resulting row and hands Zod's own message back to the form. Type a two-character title — no rule forbids it, so the save button stays live and the client-side check passes — and the answer is `a title needs at least 3 characters`, from Zod, not a 403.

The order matters and is deliberate: the guard authorises first, `validate` runs inside the handler. A row you may not touch never gets shape feedback, so the schema cannot be used as an oracle for rows you cannot see.

| Refusal | Comes from | Reads like |
|---|---|---|
| `issues` | `ability.validate` → the Zod schema | `a title needs at least 3 characters` |
| `violations` | `ability.validatePayload` → the policy | `status: value not permitted` |

**`/workspaces/[id]/analytics`** is a resource with no table at all. The instance is synthesized from the URL, and the same rule gates both the server page and the nav link (hidden) — the latter through `<Can>` from `@vetojs/react/server`, which takes the ability as a prop and needs no provider. A refused page calls Next's `forbidden()`, so the response really is `403`, not a 200 that says so.

## Try it

- **carol** — sees 4 posts, 403 on Acme analytics, but Legacy analytics works. She reads `wip-notes` even though it is someone else's draft: a second `allow` grants viewers anything past 100 views, and two `allow`s union. She edits nothing — Legacy is archived and a `deny` covers it.
- **bob** — edits his own draft. Pick `published` in the form and watch it refuse before sending; force it through anyway and the server answers the same.
- **alice** — admin of Acme: her form has an author select bob's does not, and reassigning `wip-notes` to Carol saves. She still can't edit `launch`, though: it has an unmoderated spam comment, and a deny covers that.

Switching actors is a cookie write plus `revalidatePath` — every layer re-derives from the same policy, nothing is cached per user.
