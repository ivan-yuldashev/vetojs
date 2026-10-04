# Гвард — `@vetojs/core/guard`

**[English](guard.md) · [Русский](guard.ru.md)**

Server action, route handler, инструмент агента — всё это публичные входные точки, которые кто угодно может вызвать с любыми аргументами. `createGuard` один раз описывает шаги: найти пользователя, загрузить строку, проверить и только потом выполнить.

```ts
// lib/permissions.ts
import { createGuard } from "@vetojs/core/guard";
import { ac, policyFor } from "./abilities";
import { getActor } from "./auth";

export const withPermission = createGuard({ ac, getActor, policy: policyFor });
```

| Параметр | |
|---|---|
| `ac` | ваши объявления |
| `getActor` | находит текущего пользователя, может быть асинхронным; `null` — никто не вошёл |
| `policy` | пользователь → правила |
| `getEnv` | читает [окружение](./define-abilities.ru.md#окружение-запроса) вызова из аргументов обёрнутой функции; обязателен, если в `ac` объявлено `env`, и запрещён, если нет |
| `onDeny` | что делать вместо `ForbiddenError` |
| `onUnauthenticated` | что делать, если никто не вошёл, — ответить 401 вместо 403 по умолчанию |
| `onDecision` | `(decision, actor, env)` на каждое решение — см. [журнал решений](./ability.ru.md#журнал-решений) |

Гвард не импортирует ни одного фреймворка, и в бандл, который его не импортирует, он не попадает.

## Оборачиваем действие

```ts
"use server";

export const updatePost = withPermission(
	{
		action: "update",
		resource: "post",
		load: (form: FormData) => loadPost(form.get("id")),
		payload: (form: FormData) => ({ title: String(form.get("title")) }),
	},
	async (ctx) => {
		await db.update(posts).set(ctx.payload).where(eq(posts.id, ctx.row.id));
		revalidatePath("/posts");
	},
);
```

Обёрнутая функция сохраняет сигнатуру. Обработчик получает сначала `ctx`, потом исходные аргументы:

| `ctx` | |
|---|---|
| `actor` | то, что вернул `getActor` |
| `ability` | собранный ability, привязанный к окружению, если оно есть |
| `row` | то, что вернул `load`, — никогда не пусто: пустой `load` — это отказ с `reason: "no row"` |
| `payload` | проверенные данные — пишите их, а не сырой ввод |

## Что проверяется

| Вы объявили | Гвард проверяет |
|---|---|
| `load` и `payload` | действие над строкой, затем поля и значения |
| `load` | действие над строкой |
| `payload` | поля и значения без строки: `allow` с условием на строку ничего не разрешает, `deny`, который смотрит в строку, отказывает |
| ничего | действие независимо от строки: `allow` с `where` ничего не разрешает |

Гвард проверяет права, а не форму: `{ title: "no" }` проходит против `z.string().min(3)`, потому что кривое поле — это 400, а не 403. Проверяйте форму внутри `payload`; всё, что он бросит, дойдёт до вашего обработчика ошибок нетронутым:

```ts
const updateTitle = withPermission(
	{
		action: "update",
		resource: "post",
		load: (form: FormData) => loadPost(form.get("id")),
		payload: (form: FormData) => z.object({ title: z.string().min(3) }).parse({ title: form.get("title") }),
	},
	async (ctx) => ctx.payload,
);
```

## Отказ

Неудачная проверка бросает `ForbiddenError` с `action`, `resource` и, для payload, `violations`. Или обрабатывайте централизованно:

```ts
createGuard({ ac, getActor, policy: policyFor, onDeny: () => notFound() });
```

`onDeny` и `onUnauthenticated` не должны возвращаться — подходят `notFound()`, `redirect()` и `throw`. Если хук всё-таки вернётся, гвард всё равно бросит `ForbiddenError`. Без `onUnauthenticated` отсутствующий пользователь получает `ForbiddenError`. Политика не собирается, `onDecision` ничего не слышит, так что записать попытку можно только в этом хуке:

```ts
createGuard({
	ac,
	getActor,
	policy: policyFor,
	onUnauthenticated: ({ action, resource }) => {
		throw new Response(`sign in to ${action} ${resource}`, { status: 401 });
	},
});
```

## Куда встраивается

Гвард не читает аргументы — их читают `load` и `payload`, — поэтому оборачивает любой обработчик, который является функцией:

- **Server action для `useActionState`** получает `(previousState, formData)`; объявите оба параметра в `load` и `payload`.
- **HTTP-обработчик** — Express, Fastify, Hono: см. [HTTP](./http.ru.md).
- **Вызов инструмента агентом**: см. [как охранять то, что делает агент](./agents.ru.md).

Список — это запрос, а не действие: фильтруйте его через [`where`](./where.ru.md).

## Почему так устроено

- **Настраивается один раз, применяется к каждому действию.** Действие называет только то, над чем работает.
- **Ability собирается на каждый вызов** из пользователя, поэтому между пользователями ничего не делится.
- **`ctx.payload` — проверенная копия**, так что отвергнутое поле не попадёт в запись случайно.

## Исходники

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [`guard/guard.types.ts`](../packages/core/src/guard/guard.types.ts) · [тесты](../packages/core/tests/guard/guard.test.ts)
