# Как охранять то, что делает агент

**[English](agents.md) · [Русский](agents.ru.md)**

Вызов инструмента — это эндпоинт, на другой стороне которого языковая модель. Его аргументы — догадка: схема говорит `id: string`, и модель вполне может попросить чужую строку. Поэтому вопрос не «можно ли этому агенту править посты», а «можно ли человеку, за которого он действует, опубликовать *этот* пост» — тот самый, который уже задаёт интерфейс, и отвечает на него та же политика.

veto ограничивает, до чего может дотянуться агент, но не распознаёт манипуляцию промптом. Агент, которого уговорили, всё равно получит не больше, чем мог бы его человек.

## Охраняем инструмент

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

Гвард загружает строку, которую назвала модель, и сверяет её с политикой человека до запуска обработчика. id из чужого воркспейса получает отказ; значение, которое человеку ставить нельзя, получает отказ с названием поля.

## Отказ, по которому модель может действовать

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

Если человеку можно публиковать только как `draft`, модель прочтёт `status: value not permitted` и поменяет аргумент, а не повторит тот же вызов.

## Агенту — меньше, чем его человеку

Одна политика всё равно может обращаться с агентом иначе. Объявите ключ [окружения](./define-abilities.ru.md#окружение-запроса) и напишите на него `deny`:

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

В интерфейсе, привязанном к `{ viaAgent: false }`, человек удаляет свои счета; агент может их читать, но не удалить ни одного. Окружение без `viaAgent` оставляет `deny` в силе, так что забытый ключ даёт отказ, а не разрешение.

## Фильтруем то, что агент читает

Инструмент, который ищет или выводит список, отдаёт то, что видно человеку, а не всё, до чего дотягивается сервер. Фильтруйте в базе той же политикой:

```ts
const searchPosts = async (term: string) => {
	const rows = await db.select().from(posts).where(schema.filter(ability, "read", "post"));
	return rows.filter((row: Post) => row.title.includes(term));
};
```

Именно на выборке агент с лишними правами течёт тихо: ничего не падает, модель просто видит больше. См. [фильтрацию в базе](./where.ru.md).

## Инструменты без таблицы

У почты, файлов, вебхуков и платежей нет строки, которую можно загрузить, а ошибочный вызов там не откатить. Ресурс — это существительное из вашего словаря, а не таблица, поэтому `load` собирает строку из аргументов:

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

- **Выводите то поле, которое имеете в виду.** `recipientDomain` — это решение; правило по сырому адресу с `contains` пропустит `ceo@acme.com.evil.io`. То же с корнем записи для файла, хостом вебхука, валютой платежа.
- **Сравнивайте с записью.** Правило возврата сравнивает два поля собранной строки через [`ref`](./conditions.ru.md#сравнение-двух-полей): модель не вернёт больше, чем стоил заказ.
- **Лимит, который зависит от состояния, — тоже поле.** Посчитайте накопленную сумму и положите её в строку: `where: { spentTodayCents: { lte: 50000 } }`.
- **Такому инструменту всегда нужен `load`.** Без строки `allow` с `where` ничего не разрешает, и каждый вызов получит отказ.

В карте Drizzle такие ресурсы помечаются как ресурсы без таблицы: `defineTables(ac, { email: null, refund: null })`.

## Три вещи, которые важно сделать правильно

**Инструмент без строки — строгий путь.** Если судить можно только по `payload` — `deleteFile(path)`, — а в политике есть условный `deny`, гвард отказывает каждому вызову: неизвестная строка не может доказать, что запрет не действует. Соберите строку из аргументов или оставьте запреты этого ресурса безусловными.

**Гвард проверяет права, а не форму.** `{ title: "no" }` против `z.string().min(3)` его проходит. Проверяйте аргументы раньше — SDK делают это по входной схеме инструмента — или вызовите [`ability.validate`](./ability.ru.md#validate--про-форму-данных-а-не-про-права).

**Пользователя даёт хост.** Обработчик MCP получает `(args, extra)`; в `extra.authInfo.extra` пользователя кладёт ваша проверка токена:

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

Нет `authInfo` — значит, никто не вошёл: `getActor` возвращает `null`, и гвард отказывает, не собирая политику. `betaTool` из Anthropic SDK вообще не передаёт в `run` никакой личности, поэтому инструмент создаётся под конкретный разговор, а пользователь берётся из окружающего кода.

## Журнал того, что сделал агент

```ts
const audited = createGuard({
	ac,
	getActor,
	policy: policyFor,
	onDecision: (decision, actor) => console.info({ actor: actor.id, ...decision }),
});
```

Каждая запись называет правило, которое решило. `violations` показывают поля, которые модель пыталась записать, а `reason: "no row"` — id, под которым ничего не нашлось. Если объявлено окружение, третьим аргументом приходит окружение вызова.

## Почему так устроено

- **Одна политика, а не отдельная для агентов.** Отдельный набор правил для агентов разойдётся с интерфейсом за один релиз.
- **Отказы — это данные.** `action`, `resource` и `violations` возвращаются структурой; формулировка, которую прочтёт модель, — ваша.
- **Из описания инструмента ничего не выводится.** Действие и ресурс называете вы; догадка здесь была бы решением о безопасности.

## Исходники

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [тесты](../packages/core/tests/guard/guard.test.ts) · [гвард](./guard.ru.md)
