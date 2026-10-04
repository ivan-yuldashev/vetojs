# `@vetojs/react` — доступ в интерфейсе

**[English](react.md) · [Русский](react.ru.md)**

Правила, которые охраняют сервер, решают, что показывает интерфейс. На клиент они приходят JSON, и привязки читают их.

```sh
npm install @vetojs/react @vetojs/core
```

React 18 и новее; `@vetojs/core` — peer-зависимость.

## Один раз создайте привязки

```ts
// src/authz.ts
import { createVetoContext } from "@vetojs/react";
import { ac } from "./abilities";

export const { AbilityProvider, useAbility, useCan, useSetRules, Can } = createVetoContext(ac);
```

Фабрика несёт тип вашего `ac`, поэтому `<Can>` предлагает действия каждого ресурса и отвергает остальные. Если объявлено [`env`](./define-abilities.ru.md#окружение-запроса), передайте ещё и `withEnv`: `createVetoContext(ac, withEnv)`.

Если модуль публикуется в пакете, аннотируйте каждый экспорт — `export const Can: VetoContext<AC>["Can"] = veto.Can`, — иначе сгенерированный `.d.ts` повторит всю карту ресурсов для каждой привязки.

## Передайте правила

```tsx
<AbilityProvider rules={rules}>
	<App />
</AbilityProvider>
```

`rules` — это `ability.rules` с сервера; правила, пришедшие по сети, проверяйте через [`parseRules`](./parse.ru.md). Уже собранный ability передаётся в `ability={ability}`; передать оба нельзя — это ошибка типов. С окружением провайдер принимает его рядом с правилами — `<AbilityProvider rules={rules} env={{ hour, mfa }}>`, — и смена любого из них перепривязывает правила.

Провайдер пересобирается, когда меняется ссылка на `rules`, а функция политики возвращает новый массив при каждом вызове. Мемоизируйте по пользователю или передавайте изменения через [`useSetRules`](#usesetrules--смена-пользователя).

## `<Can>`

```tsx
<Can I="update" a="post" this={post} fallback={<DisabledButton />}>
	<EditButton />
</Can>
```

Без `fallback` отказ ничего не рисует. Уберите `this`, когда строки ещё нет, — кнопка «Новый пост» спрашивает, возможно ли действие вообще:

```tsx
<Can I="create" a="post">
	<NewPostButton />
</Can>
```

```tsx
<Can I="archive" a="post">   {/* ✗ у "post" нет действия "archive" */}
<Can I="update" a="posts">   {/* ✗ такого ресурса нет */}
```

## `useCan` и `useAbility`

```tsx
const canEdit = useCan("update", "post", post);

const ability = useAbility();
const writable = ability.permittedFields("update", "post", post, ["title", "status"]);
```

`useCan` подписывается на один вердикт и перерисовывает, только когда он меняется; `<Can>` использует его внутри. `useAbility` отдаёт [ability](./ability.ru.md) целиком и перерисовывает при любой смене правил — берите его, когда нужно больше, чем «да» или «нет». Вне провайдера он бросает исключение, а не делает вид, что ничего не разрешено.

## `useSetRules` — смена пользователя

Новые `rules`, переданные пропом, перерисовывают предка, который их держит, и всё его поддерево. `useSetRules` пишет прямо в хранилище, поэтому обновляются только изменившиеся вердикты:

```tsx
const setRules = useSetRules();

const onSwitchActor = async (id: string) => {
	setRules(await fetchRulesFor(id));
};
```

## Экраны и вкладки

Вкладка или страница настроек, за которыми нет таблицы, — тоже ресурс, а его строка — то, что определяет этот экран, обычно параметры маршрута:

```tsx
const ac = defineAbilities({
	resources: { analytics: { schema: shape<{ workspaceId: string }>(), actions: ["view"] } },
});
const { Can } = createVetoContext(ac);

const AnalyticsTab = ({ workspaceId }: { workspaceId: string }) => (
	<Can I="view" a="analytics" this={{ workspaceId }} fallback={<Forbidden />}>
		<AnalyticsPanel />
	</Can>
);
```

Передавайте `this`, когда у экрана есть параметр: без строки ответ оптимистичен, и вкладка появится в каждом воркспейсе. Экран, которому не на чем строить ключ, обходится без `schema`. Сервер проверяет так же — `can("view", "analytics", { workspaceId })` там, где рендерится страница, — а карта Drizzle пишет `analytics: null`.

## Серверные компоненты

На сервере нет ни контекста, ни клиентской границы — спрашивайте ability, который у вас уже есть:

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>;
```

Обе ветки решаются во время рендера, и в браузер попадает только выбранная. Собирайте ability один раз на запрос — в Next через `cache` из React; с окружением привязывайте его там же — `withEnv(buildAbility(ac, policyFor(actor)), env)`.

Спрятать элемент — вежливость, а не защита: сервер всё равно проверяет каждое действие [гвардом](./guard.ru.md) или через [`where`](./where.ru.md).

## Почему так устроено

- **Фабрика, а не глобальный импорт.** Типизированным привязкам нужен ваш `ac`, а импорт на уровне модуля его не получит.
- **`useAbility` без провайдера бросает исключение.** Значение «всё запрещено» по умолчанию выглядело бы решением политики и спрятало бы ошибку подключения.
- **Две точки входа**, потому что `"use client"` помечает модуль целиком: серверный `<Can>` живёт в `@vetojs/react/server`, и серверный компонент не превращается в клиентский ради одной кнопки.
- **Клиентский `<Can>` тоже принимает `ability`.** Если он передан, контекст игнорируется; если нет ни того, ни другого — исключение, а не догадка.

## Исходники

[`context.ts`](../packages/react/src/context.ts) · [`types.ts`](../packages/react/src/types.ts) · тесты: [render](../packages/react/tests/render.test.ts), [context](../packages/react/tests/context.test.ts), [provider](../packages/react/tests/provider.test.ts)
