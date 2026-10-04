# Как охранять то, что делает агент

**[English](agents.md) · [Русский](agents.ru.md)**

Вызов инструмента — это точка входа, по ту сторону которой языковая модель. Аргументы там не форма, заполненная человеком, а догадка: модель спокойно попросит строку, принадлежащую кому-то другому, раз в схеме написано `id: string`.

Поэтому вопрос не «можно ли этому агенту публиковать посты», а **«можно ли человеку, от имени которого он действует, опубликовать *этот* пост»** — тот же вопрос, что задаёт интерфейс, и отвечает на него та же политика.

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

`args.id` выбрала модель. Гвард загрузит эту строку и проверит её по политике пользователя, поэтому идентификатор из чужого воркспейса будет отклонён ещё до того, как ваш обработчик начнёт существовать.

## Отказ и есть главное

Глухое «нельзя» ничему модель не учит, и она повторяет тот же вызов. Отказ, называющий поле, позволяет ей исправиться:

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

Против политики, где редактору разрешён только `draft`, запрос `published` вернётся как `status: value not permitted`, а не как стена. Эта фраза и есть продукт: её модель читает перед следующей попыткой.

## Чтение — вторая половина

Инструмент, который ищет или показывает список, обязан вернуть то, что видит **пользователь**, а не то, что видит сервер. Это запрос, а не проверка, поэтому фильтруйте в базе той же политикой:

```ts
const search = async (args: { term: string }) => {
	const rows = await db
		.select()
		.from(posts)
		.where(schema.filter(ability, "read", "post"));

	return rows.filter((row: Post) => row.title.includes(args.term));
};
```

Именно на выборке агент с лишними правами течёт тихо: ничего не бросается, просто модель видит больше, чем тот, кто её попросил. См. [фильтрацию в базе](./where.ru.md) и [адаптер Drizzle](./drizzle.ru.md).

## Не каждый инструмент ходит в базу

Отправить письмо, записать файл, дёрнуть вебхук, провести оплату — строки для загрузки здесь нет, и именно тут неверный вызов стоит дороже всего: откатом такое не отменяется. Вопрос не меняется, механизм тоже: **ресурс — это существительное вашего словаря, а не таблица**. Строка — описание самого действия, собранное из аргументов, которые выбрала модель.

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

Именно в `load` аргументы инструмента превращаются в то, о чём политика умеет судить, и поле стоит выводить то самое, которое вы имеете в виду. `recipientDomain` — это решение; сырой адрес — строка, и правило по строке с `contains` пропустит `ceo@acme.com.evil.io`: `@acme.com` в нём есть, а домен у него `evil.io`. Остальные эффекты выводятся так же: корень записи для файла (чтобы `../../etc/passwd` не прошёл за загрузку), хост и метод для вебхука, валюта и сумма для платежа.

**Инструменту-эффекту всегда давайте `load`.** Без строки гвард пропускает только то, чего никакая строка не изменила бы: `allow` с `where` ничего не даёт, и политика, которая судит вызов по тому, что он делает, откажет всем вызовам, законным тоже. Собрать строку стоит нескольких строк кода, и тогда гвард рассудит именно этот вызов до того, как дойдёт до вашего обработчика.

**Лимит, который является состоянием, — это просто ещё одно поле.** «Не больше $500 в день» — не свойство вызова, поэтому поднимите накопленную сумму и положите её в строку: `where: { spentTodayCents: { lte: 50000 } }` читается ровно так, как звучит правило. Никто ничего за вас не считает — veto отвечает про одно решение по тем значениям, которые вы передали.

**Гейт payload работает и здесь.** Объявленный на действии `payload` сужает то, что модели позволено писать, а отказ называет поле — `amountCents: value not permitted` и есть то, что модель прочитает перед следующей попыткой.

Таблицы у такого ресурса нет, и адаптеру об этом сообщают: `defineTables(ac, { email: null })`. Фильтрация — вопрос про чтение, поэтому `where` и `filter` к нему не применяются: и проход по связи, и попытка отфильтровать бросают исключение, а не тихо собирают SQL.

## Три вещи, которые надо сделать правильно

**Инструмент с аргументами и без строки — строгий путь.** Если загрузить нечего — у `deleteFile(path)` строки нет, — гварду остаётся судить по одному payload, и против политики с **условным `deny`** он откажет всем вызовам, включая законные. Это записанный контракт, а не дефект: неизвестная строка не может доказать, что запрет не сработал. Дайте инструменту `load` — для эффекта строка [собирается из аргументов](#не-каждый-инструмент-ходит-в-базу) — или держите запреты этого ресурса безусловными.

**Гвард проверяет права, а не форму данных.** `validatePayload` отвечает на вопрос *можно ли этому пользователю писать такие поля и значения*. Схему ресурса он не запускает, поэтому `{ title: "no" }` при `z.string().min(3)` пройдёт. Проверяйте аргументы заранее — SDK делают это по входной схеме инструмента — или зовите [`ability.validate`](./ability.ru.md) сами.

**Пользователь приходит от хоста, и два хоста устроены по-разному.**

Обработчик инструмента MCP получает `(args, extra)`, а `extra.authInfo` — это то, что оставила после себя проверка токена на сервере: сам `token`, `clientId`, выданные `scopes` и мешок `extra`, куда ваш валидатор кладёт разобранного пользователя — `sub`, `userId`, что там несут ваши токены.

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

Собирайте его там, где этот контекст в области видимости, — внутри обработчика, — и инструмент читается как любой другой:

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

Нет `authInfo` — значит никто не вошёл: `getActor` вернёт `null`, и гвард пойдёт по своей ветке для неаутентифицированных, а не станет собирать политику для несуществующего пользователя.

У Anthropic SDK всё иначе. `betaTool({ name, inputSchema, description, run })` передаёт в `run` контекст `{ toolUse, signal }` — блок вызова инструмента и сигнал отмены, **идентичности там нет вовсе**. Актор приходит из окружающей области видимости: инструмент определяется на разговор, для пользователя, который вам уже известен.

В обоих случаях `getActor` пишете вы. Из вызова инструмента о вызывающем не выводится ничего.

## Почему так устроено

- **Одна политика, а не вторая для агентов.** Отдельный набор правил для агента разъедется с интерфейсным за один релиз. Гвард берёт тот же `policyFor(actor)`, что и всё остальное приложение.
- **Отказ несёт структуру, а не текст.** `action`, `resource` и `violations` по полям — это данные; превращать их во фразу вам, потому что формулировка, после которой модель исправляется, зависит от вашего продукта.
- **Из определения инструмента ничего не выводится.** Гвард не читает имя и схему инструмента, чтобы угадать действие и ресурс, — вы называете их сами, потому что догадка здесь была бы решением о безопасности.

## Исходники

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [тесты](../packages/core/tests/guard/guard.test.ts) · [гвард в целом](./guard.ru.md)
