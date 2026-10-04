# Guarding what an agent does

**[English](agents.md) · [Русский](agents.ru.md)**

A tool call is an endpoint with a language model on the other side. The arguments are not a form a user filled in — they are a guess, produced by something that will happily ask for a row belonging to someone else because the schema said `id: string`.

So the question is not "may this agent write posts". It is **"may the person this agent is acting for write *this* post"** — the same question the UI asks, answered by the same policy.

```ts
type PublishArgs = { id: string; status: "draft" | "published" };

const publish = withPermission(
	{
		action: "publish",
		resource: "post",
		load: (args: PublishArgs) => loadPost(args.id),
		payload: (args: PublishArgs) => ({ status: args.status }),
	},
	async (ctx) => `published ${ctx.row.id}`,
);
```

The model chose `args.id`. The guard loads that row and checks it against the actor's policy, so an id belonging to another workspace is refused before your handler exists.

## The refusal is the feature

An opaque "forbidden" teaches a model nothing, and it retries the same call. A refusal that names the field lets it correct itself:

```ts
const call = async (args: { id: string; status: "draft" | "published" }) => {
	try {
		return { content: [{ type: "text", text: await publish(args) }] };
	} catch (error) {
		if (!ForbiddenError.is(error)) {
			throw error;
		}

		const detail = error.violations
			?.map((violation) => `${violation.field}: ${violation.reason}`)
			.join("; ");

		return {
			content: [
				{
					type: "text",
					text: `Not permitted to ${error.action} ${error.resource}${detail ? ` — ${detail}` : ""}`,
				},
			],
			isError: true,
		};
	}
};
```

Against a policy that lets an editor set `status` only to `draft`, asking for `published` comes back as `status: value not permitted` rather than a wall. That sentence is the product: it is what the model reads before its next attempt.

## Reading is the other half

A tool that lists or searches must return what the **actor** may see, not what the server may see. That is a query, not a check — so filter it in the database with the same policy:

```ts
const search = async (args: { term: string }) => {
	const rows = await db
		.select()
		.from(posts)
		.where(schema.filter(ability, "read", "post"));

	return rows.filter((row: Post) => row.title.includes(args.term));
};
```

Retrieval is where an over-permissioned agent leaks quietly: nothing throws, the model simply sees more than the person asking it. See [filtering in the database](./where.md) and the [Drizzle adapter](./drizzle.md).

## Not every tool touches a database

Sending mail, writing a file, calling a webhook, moving money — none of these have a row to fetch, and they are where a wrong tool call costs the most, because nothing about them can be undone by a rollback. The question is unchanged, and so is the mechanism: **a resource is a noun in your vocabulary, not a table**. The row is a description of the effect itself, computed from the arguments the model chose.

```ts
const ac = defineAbilities({
	resources: {
		email: {
			schema: shape<{
				workspaceId: string;
				recipientDomain: string;
				attachments: number;
			}>(),
			actions: ["send"],
		},
	},
});

const { allow, deny } = createRules(ac);

const policyFor = (actor: { id: string; workspaceId: string }) => [
	allow("send", "email", {
		where: {
			workspaceId: actor.workspaceId,
			recipientDomain: { in: ["acme.com"] },
		},
	}),
	deny("send", "email", { where: { attachments: { gt: 0 } } }),
];

const withPermission = createGuard({
	ac,
	getActor: () => agent,
	policy: policyFor,
});

const domainOf = (address: string) =>
	address.slice(address.lastIndexOf("@") + 1).toLowerCase();

type SendArgs = { to: string; subject: string; attachments: string[] };

const sendEmail = withPermission(
	{
		action: "send",
		resource: "email",
		load: (args: SendArgs) => ({
			workspaceId: agent.workspaceId,
			recipientDomain: domainOf(args.to),
			attachments: args.attachments.length,
		}),
	},
	async (_ctx, args: SendArgs) =>
		sendMail({ to: args.to, subject: args.subject }),
);
```

`load` is where a tool's arguments become something a policy can judge, and it is worth deriving the field you actually mean. `recipientDomain` is a decision; the raw address is a string, and a rule written against the string with `contains` accepts `ceo@acme.com.evil.io` — it does contain `@acme.com`, while its domain is `evil.io`. The same shape of derivation covers the other effects: the write root for a file (so `../../etc/passwd` cannot pass as an upload), the host and method for a webhook, the currency and amount for a charge.

**Give an effect tool a `load`, always.** Without a row the guard grants only what no row could change: an `allow` with a `where` grants nothing, so a policy that judges the call by what it does refuses every call, legitimate ones included. Synthesizing the row is a few lines, and the guard then judges this call before your handler runs.

**A limit that is state is just another field.** "No more than $500 a day" is not a property of the call, so look the running total up and put it in the row: `where: { spentTodayCents: { lte: 50000 } }` then reads the way the rule sounds. Nothing counts for you — veto answers about one decision, from the values you hand it.

**The payload gate still applies.** Declaring `payload` on the action narrows what the model may write, and the refusal names the field — `amountCents: value not permitted` is what the model reads before its next attempt.

A resource like this has no table, and the adapter is told so: `defineTables(ac, { email: null })`. Filtering is a question about reading, so `where` and `filter` never apply to it — and reaching one through a relation or filtering on it throws rather than quietly producing SQL.

## Three things to get right

**A tool with arguments and no row is the strict path.** If you cannot `load` — `deleteFile(path)` has no row to fetch — the guard has only the payload to judge, and against a policy carrying a **conditional `deny`** it refuses every call, including legitimate ones. That is the documented contract, not a bug: an unknown row cannot prove a deny false. Give the tool a `load` — for an effect you [build the row from the arguments](#not-every-tool-touches-a-database) — or keep the resource's denies unconditional.

**The guard checks permissions, not shapes.** `validatePayload` answers *may this actor write these fields and values*. It does not run the resource's schema, so `{ title: "no" }` against `z.string().min(3)` passes the guard. Validate the arguments first — the SDKs do it from the tool's input schema — or call [`ability.validate`](./ability.md) yourself.

**The actor comes from the host, and the two hosts differ.**

An MCP tool handler receives `(args, extra)`, and `extra.authInfo` is what the server's token validation left behind: the `token` itself, the `clientId`, the granted `scopes`, and an `extra` bag where your validator puts the resolved user — `sub`, `userId`, whatever your tokens carry.

```ts
const guardFor = (authInfo: { extra?: Record<string, unknown> } | undefined) =>
	createGuard({
		ac,
		getActor: () =>
			authInfo?.extra?.sub === undefined
				? null
				: { id: String(authInfo.extra.sub) },
		policy: policyFor,
	});
```

Build it where that context is in scope — inside the handler — and the tool reads like any other:

```ts
server.registerTool(
	"publish_post",
	{
		description: "Publish a post the current user owns",
		inputSchema: { id: z.string(), status: z.enum(["draft", "published"]) },
	},
	async (args: { id: string; status: "draft" | "published" }, extra: {
		authInfo?: { extra?: Record<string, unknown> };
	}) => {
		const publish = guardFor(extra.authInfo)(
			{
				action: "publish",
				resource: "post",
				load: () => loadPost(args.id),
				payload: () => ({ status: args.status }),
			},
			async (ctx) => `published ${ctx.row.id}`,
		);

		return { content: [{ type: "text", text: await publish() }] };
	},
);
```

No `authInfo` means nobody is signed in, so `getActor` returns `null` and the guard takes its unauthenticated path rather than building a policy for a non-user.

The Anthropic SDK is the other case. `betaTool({ name, inputSchema, description, run })` hands `run` a context of `{ toolUse, signal }` — the tool-use block and an abort signal, **no identity at all**. There the actor comes from the surrounding scope: the tool is defined per conversation, for a user you already know.

Either way `getActor` is a function you write. Nothing about the caller is inferred from the tool call.

## Why it works this way

- **One policy, not a second one for agents.** An agent that gets its own rule set drifts from the UI's within a release. The guard takes the same `policyFor(actor)` the rest of the app uses.
- **Refusals carry structure, not prose.** `action`, `resource` and per-field `violations` are data; turning them into a sentence is your call, because the wording that makes a model retry well is specific to your product.
- **Nothing is inferred from the tool definition.** The guard never reads the tool's name or schema to guess an action or resource — you name them, because a guess here is a security decision.

## Source

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [tests](../packages/core/tests/guard/guard.test.ts) · [the guard in general](./guard.md)
