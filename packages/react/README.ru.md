# ⚡ @vetojs/react

> Авторизация в React: одни и те же правила решают, что можно на сервере и что показывать в интерфейсе.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Freact)](https://www.npmjs.com/package/@vetojs/react)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@vetojs/react?activeTab=dependencies)
[![React](https://img.shields.io/badge/react-%E2%89%A518-61dafb)](https://react.dev)
[![License](https://img.shields.io/npm/l/%40vetojs%2Freact)](https://github.com/ivan-yuldashev/vetojs/blob/main/LICENSE)
[![Socket](https://socket.dev/api/badge/npm/package/@vetojs/react)](https://socket.dev/npm/package/@vetojs/react)

Привязки к React для [`@vetojs`](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md) — **[English](README.md) · [Русский](README.ru.md)**.

[`@vetojs`](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md) описывает права как массив правил в обычном JSON: кто из пользователей что может делать и с какими строками. Сервер собирает этот массив для текущего пользователя и отдаёт его на клиент как есть — сериализовать нечего, это уже JSON.

Пакет подключает тот самый массив к React. Кнопки, вкладки и списки спрашивают у него, что показывать, поэтому второй копии логики доступа на клиенте не появляется.

## Почему @vetojs/react

- **Типы выводятся сами.** `createVetoContext(ac)` запоминает вашу схему: `<Can>` подсказывает действия, доступные именно этому ресурсу, и не пропускает несуществующие.
- **RSC без клиентской границы.** `@vetojs/react/server` закрывает серверный компонент за **98 байт** — ни директив, ни хуков, ни контекста в браузере.
- **Точечные ререндеры.** `useCan` подписывается на один вердикт и будит только ту строку, чей ответ изменился.
- **0 зависимостей.** `react` и `@vetojs/core` — peer-зависимости, ничего своего пакет в дерево не добавляет.

---

## Quick Start

### 1. Установка

```sh
npm install @vetojs/react @vetojs/core
# или
pnpm add @vetojs/react @vetojs/core
```

Только ESM, Node.js 20 и новее, React 18 и новее.

### 2. Соберите привязки один раз

```ts
// src/authz.ts
import { createVetoContext } from "@vetojs/react";
import { defineAbilities, shape } from "@vetojs/core";

export const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published" }>(),
			actions: ["read", "update", "publish"],
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

export const { AbilityProvider, useAbility, useCan, useSetRules, Can } =
	createVetoContext(ac);
```

Почему фабрика, а не готовый импорт: типизированным привязкам нужен ваш `ac`. Из него `<Can>` берёт список действий для каждого ресурса.

### 3. Отдайте правила в дерево

```tsx
<AbilityProvider rules={rules}>
	<App />
</AbilityProvider>
```

В `rules` едет `ability.rules` — тот самый плоский массив с сервера. Если ability на клиенте уже собран, передайте `ability` вместо `rules`; вместе — нельзя, и это проверяет тип.

### 4. Спрячьте то, на что нет прав

```tsx
<Can I="update" a="post" this={post} fallback={<DisabledButton />}>
	<EditButton />
</Can>
```

Читается как фраза: «я могу обновить *этот* пост». Строки ещё нет — например, кнопка «создать» — уберите `this`, и проверка ответит, доступно ли действие в принципе.

## Типы выводятся сами

Список действий для `<Can>` и хуков берётся из вашего `ac` — того, что объявлен на шаге 2:

```tsx
type Resources = ResourceName<typeof ac>;
//   ^? "post" | "user"

type PostActions = ActionFor<typeof ac, "post">;
//   ^? "read" | "update" | "publish" | "manage"

const canEdit = useCan("update", "post", post);
//    ^? boolean

<Can I="publish" a="post" this={post} fallback={<DisabledButton />}>
//     ^| автодополнение предложит только эти четыре действия
	<EditButton />
</Can>;
```

`manage` добавляется к каждому ресурсу — это подстановочное действие, покрывающее все остальные.

Несуществующее действие и провайдер с двумя источниками правил — ошибки компиляции:

```tsx
<Can I="archive" a="post" this={post}>
//     ^^^^^^^^^ ✗ Type '"archive"' is not assignable to type 'ActionFor<…, "post">'
	<EditButton />
</Can>;

<AbilityProvider rules={rules} ability={ability}>
//                             ^^^^^^^ ✗ Type 'AbilitySet<…>' is not assignable to type 'undefined'
	<EditButton />
</AbilityProvider>;
```

## Чем спрашивать: четыре инструмента

Вопрос один и тот же, инструментов четыре. Разница — в том, где вы находитесь и что перерисуется.

| Что нужно | Инструмент | Где работает | Что стоит |
|---|---|---|---|
| Закрыть разметку в серверном компоненте | `<Can>` из `@vetojs/react/server` | RSC, SSR | 98 байт, и разрешённая, и запрещённая разметка выбирается на сервере |
| Закрыть разметку на клиенте | `<Can>` из `createVetoContext` | клиент | подписка на один вердикт |
| Один ответ «да/нет» в логике | `useCan` | клиент | ререндер только при смене вердикта |
| Несколько проверок, `permittedFields`, `where` | `useAbility` | клиент | ререндер на любую смену правил |

`useAbility` вне `AbilityProvider` не притворяется, что «всё запрещено», а сразу бросает исключение.

## На сервере контекст не нужен

В серверном компоненте `ability` уже под рукой — ни провайдера, ни хуков, ни клиентской границы:

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>;
```

Схема ресурсов выводится прямо из переданного `ability`, поэтому фабрика здесь не нужна. Какую из двух разметок показать — `children` или `fallback` — решается на сервере, поэтому в браузер уезжает только выбранная, а сам компонент не уезжает вовсе.

## Точечный ререндер вместо общего

`useCan` подписывается на один вердикт, `<Can>` использует его внутри. На списке из пятидесяти закрытых строк смена вердикта у одной разбудит одну строку, а не пятьдесят:

```tsx
const visible = postList.filter((item) => ability.can("read", "post", item));
const writable = ability.permittedFields("update", "post", ["title", "status"]);
```

## Смена пользователя без лишних рендеров

Новые `rules` можно передать провайдеру пропсом, но проп живёт в состоянии компонента-предка — значит перерисуется и предок, и всё дерево под ним. `useSetRules` пишет прямо во внутренний стор:

```tsx
const setRules = useSetRules();

const onSwitchActor = async (id: string) => {
	setRules(await fetchRulesFor(id));
};
```

Компоненты выше по дереву не трогаются, обновляются только строки, чей вердикт действительно изменился. Итог: `rules` — для первичной инициализации с сервера, `useSetRules` — для смены контекста на лету.

## Спрятать кнопку — не значит защитить данные

Скрытый элемент интерфейса — это вежливость к пользователю, а не защита: запрос, который эта кнопка отправляла бы, можно отправить и руками. Каждое действие по-прежнему проверяется на сервере — [гвардом](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.ru.md) или `ability.authorize()`. Ценность пакета в другом: сервер и интерфейс читают один массив правил, поэтому UI не может разойтись с реальными разрешениями.

## Roadmap

Пакет закрывает свой API целиком: провайдер, три хука и два `<Can>`. Дальше меняется только ядро — новые возможности приезжают сюда вместе с [`@vetojs/core`](https://github.com/ivan-yuldashev/vetojs/tree/main/packages/core).

## Contributing

Не хватает хука, неудобен проп, мешает лишний ререндер — [расскажите об этом в issue](https://github.com/ivan-yuldashev/vetojs/issues/new). Пожелания к API читаются наравне с баг-репортами и влияют на то, что делается следующим.

Порядок работы описан в [CONTRIBUTING.md](https://github.com/ivan-yuldashev/vetojs/blob/main/CONTRIBUTING.md), сообщения об уязвимостях — в [SECURITY.md](https://github.com/ivan-yuldashev/vetojs/blob/main/SECURITY.md).

## Что дальше

- **[Полное руководство](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/react.ru.md)** — провайдер, `<Can>`, `useAbility` и нюансы серверных компонентов.
- **[О проекте](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md)** — общая концепция `@vetojs` и устройство движка.
- **[Для агентов](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.ru.md)** и **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — весь API на одной странице, под контекст ИИ-ассистента: дайте ссылку Claude, Cursor или Copilot.
- **Пример** — [react-spa](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/react-spa): правила уезжают на клиент и управляют интерфейсом.

## Лицензия

MIT
