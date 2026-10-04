# Guarding what an agent does

**[English](agents.md) · [Русский](agents.ru.md)**

A tool call is an endpoint with a language model on the other side. Its arguments are a guess: the schema says `id: string`, and the model may well ask for someone else's row. So the question is not "may this agent edit posts" but "may the person it acts for publish *this* post" — the one the interface already asks, answered by the same policy.

veto limits what an agent can reach; it does not detect a manipulated prompt. An agent talked into something still gets no more than its person could do.

## Guard a tool

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

The guard loads the row the model named and checks it against the person's policy before the handler runs. An id from another workspace is refused; a value the person may not set is refused with the field named.

## Return a refusal the model can act on

```ts
const call = async (args: PublishArgs) => {
	try {
		return { content: [{ type: "text", text: await publish(args) }] };
	} catch (error) {
		if (!ForbiddenError.is(error)) {
			throw error;
		}

		const detail = error.violations?.map((v) => `${v.field}: ${v.reason}`).join("; ");

		return {
			isError: true,
			content: [{ type: "text", text: `Not permitted to ${error.action} ${error.resource}${detail ? ` — ${detail}` : ""}` }],
		};
	}
};
```

When the person may publish only as `draft`, the model reads `status: value not permitted` and changes the argument instead of repeating the call.

## Give the agent less than its person

One policy can still treat the agent differently. Declare an [environment](./define-abilities.md#the-requests-environment) key and write a `deny` on it:

```ts
const ac = defineAbilities({
	env: shape<{ viaAgent: boolean }>(),
	resources: {
		invoice: { schema: shape<{ id: string; ownerId: string }>(), actions: ["read", "delete"] },
	},
});
const { allow, deny } = createRules(ac);

const policyFor = (actor: { id: string }) => [
	allow(["read", "delete"], "invoice", { where: { ownerId: actor.id } }),
	deny("delete", "invoice", { when: { viaAgent: true } }),
];

const forAgent = createGuard({ ac, getActor, policy: policyFor, getEnv: () => ({ viaAgent: true }) });
```

The person deletes their invoices in the interface, bound with `{ viaAgent: false }`; the agent can read them and cannot delete one. An environment that leaves `viaAgent` out keeps the `deny` standing, so a forgotten key refuses rather than grants.

## Filter what the agent reads

A tool that lists or searches returns what the person may see, not what the server can reach. Filter in the database with the same policy:

```ts
const searchPosts = async (term: string) => {
	const rows = await db.select().from(posts).where(schema.filter(ability, "read", "post"));
	return rows.filter((row: Post) => row.title.includes(term));
};
```

Retrieval is where an over-permissioned agent leaks quietly: nothing throws, the model just sees more. See [filtering in the database](./where.md).

## Tools without a table

Mail, files, webhooks, payments have no row to fetch, and a wrong call there cannot be rolled back. A resource is a noun in your vocabulary, not a table, so `load` builds the row from the arguments:

```ts
const ac = defineAbilities({
	resources: {
		email: { schema: shape<{ recipientDomain: string; attachments: number }>(), actions: ["send"] },
		refund: { schema: shape<{ amountCents: number; orderTotalCents: number }>(), actions: ["issue"] },
	},
});
const { allow, deny } = createRules(ac);

const policyFor = () => [
	allow("send", "email", { where: { recipientDomain: { in: ["acme.com"] } } }),
	deny("send", "email", { where: { attachments: { gt: 0 } } }),
	allow("issue", "refund", { where: { amountCents: { lte: { ref: "orderTotalCents" } } } }),
];

const withPermission = createGuard({ ac, getActor: () => agent, policy: policyFor });

type SendArgs = { to: string; subject: string; attachments: string[] };

const sendEmail = withPermission(
	{
		action: "send",
		resource: "email",
		load: (args: SendArgs) => ({
			recipientDomain: args.to.slice(args.to.lastIndexOf("@") + 1).toLowerCase(),
			attachments: args.attachments.length,
		}),
	},
	async (_ctx, args: SendArgs) => sendMail({ to: args.to, subject: args.subject }),
);
```

- **Derive the field you mean.** `recipientDomain` is a decision; a rule on the raw address with `contains` accepts `ceo@acme.com.evil.io`. The same goes for the write root of a file, the host of a webhook, the currency of a charge.
- **Compare against the record.** The refund rule compares two fields of the built row with [`ref`](./conditions.md#comparing-two-fields): the model cannot refund more than the order was worth.
- **A limit that is state is a field.** Look up the running total and put it in the row: `where: { spentTodayCents: { lte: 50000 } }`.
- **Always give such a tool a `load`.** Without a row an `allow` with a `where` grants nothing, so every call would be refused.

The Drizzle map marks these resources as tableless: `defineTables(ac, { email: null, refund: null })`.

## Three things to get right

**A tool with no row is the strict path.** With only `payload` to judge — `deleteFile(path)` — the guard refuses every call when the policy has a conditional `deny`: an unknown row cannot prove the deny false. Build the row from the arguments, or keep that resource's denies unconditional.

**The guard checks permissions, not shapes.** `{ title: "no" }` against `z.string().min(3)` passes it. Validate arguments first — the SDKs do it from the tool's input schema — or call [`ability.validate`](./ability.md#validate--shape-not-permission).

**The actor comes from the host.** An MCP handler receives `(args, extra)`; `extra.authInfo.extra` is where your token validation put the user:

```ts
const guardFor = (authInfo: { extra?: Record<string, unknown> } | undefined) =>
	createGuard({
		ac,
		getActor: () => (authInfo?.extra?.sub === undefined ? null : { id: String(authInfo.extra.sub) }),
		policy: policyFor,
	});

server.registerTool(
	"publish_post",
	{
		description: "Publish a post the current user owns",
		inputSchema: { id: z.string(), status: z.enum(["draft", "published"]) },
	},
	async (args: PublishArgs, extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
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

No `authInfo` means nobody is signed in: `getActor` returns `null`, and the guard refuses without building a policy. The Anthropic SDK's `betaTool` hands `run` no identity at all, so the tool is defined per conversation and the actor comes from the surrounding scope.

## Record what the agent did

```ts
const audited = createGuard({
	ac,
	getActor,
	policy: policyFor,
	onDecision: (decision, actor) => console.info({ actor: actor.id, ...decision }),
});
```

Each entry names the rule that decided. `violations` show the fields the model tried to write, and `reason: "no row"` an id that matched nothing. With an environment declared, the third argument is the environment of the call.

## Why it works this way

- **One policy, not a second one for agents.** A separate rule set for agents drifts from the interface's within a release.
- **Refusals are data.** `action`, `resource` and `violations` come back structured; the wording the model reads is yours.
- **Nothing is inferred from the tool definition.** You name the action and the resource; a guess there would be a security decision.

## Source

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [tests](../packages/core/tests/guard/guard.test.ts) · [the guard](./guard.md)
