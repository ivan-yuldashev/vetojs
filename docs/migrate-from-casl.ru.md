# Переход с CASL

**[English](migrate-from-casl.md) · [Русский](migrate-from-casl.ru.md)**

Сверено с `@casl/ability@7.0.1` и `@casl/react@7.0.1`.

Бо́льшая часть перехода механическая. Под ней лежит одна идея, которая механической не является, — если понять её первой, остальное станет очевидным.

## Что меняется по существу

В CASL ability — это **экземпляр класса**, а объект помечается изменением самого объекта. В Veto ability — это **замыкания над обычными данными**, а имя ресурса передаётся аргументом.

```ts
// CASL — помечается объект
ability.can("update", subject("Post", post));

// Veto — передаётся имя
ability.can("update", "post", post);
```

Из этого одного различия следует всё остальное: ваши объекты никто не оборачивает, `ability.rules` — это JSON, который можно отправить куда угодно, а серверный компонент передаёт правила клиенту без плясок с сериализацией.

## Объявление предметной области

CASL ничего не выводит — алгебру типов и формы вы пишете руками:

```ts
type Abilities = ["read" | "update", "Post" | Post] | ["read", "User" | User];
const ability = createMongoAbility<MongoAbility<Abilities>>(rules);
```

Veto берёт одно объявление и выводит из него всё:

```ts
const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published" }>(),
			actions: ["read", "update"],
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});
```

Имена ресурсов здесь — строки в нижнем регистре, а не имена классов: это ключи вашего объявления, поэтому `"post"`, а не `"Post"`.

## Написание правил

```ts
// CASL
const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
can("read", "Post", { status: "published" });
cannot("update", "Post", { status: "archived" });
const ability = build();
```

```ts
// Veto
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	deny("update", "post", { where: { status: "archived" } }),
];

const ability = buildAbility(ac, policyFor(currentUser));
```

Два отличия стоит заметить. Условия живут под ключом `where`, потому что Veto разделяет *какие строки* и *какие поля со значениями* — см. [запись](./mutations.ru.md). И политика — это обычная функция от пользователя, возвращающая массив: никакого билдера держать не нужно и `build()` вызывать не нужно.

## Условия

CASL принимает синтаксис запросов MongoDB. Veto — короткую запись с именованными операторами.

| CASL | Veto |
|---|---|
| `{ status: "published" }` | `{ status: "published" }` |
| `{ views: { $gt: 100 } }` | `{ views: { gt: 100 } }` |
| `$eq` `$ne` `$in` `$nin` | `eq` `ne` `in` `nin` |
| `$gt` `$gte` `$lt` `$lte` | `gt` `gte` `lt` `lte` |
| `{ deletedAt: { $exists: false } }` | `{ deletedAt: { exists: false } }` |
| `{ $and: [...] }` `{ $or: [...] }` | `{ and: [...] }` `{ or: [...] }` |
| `{ $not: ... }` | `{ not: ... }` |
| `{ title: { $regex: /release/ } }` | `{ title: { contains: "release" } }` — только вхождение подстроки |
| `{ comments: { $elemMatch: { spam: true } } }` | `{ comments: { some: { spam: true } } }` — объявленная [связь](./relations.ru.md) |

**Аналогов нет намеренно:** `$where` (произвольный JavaScript внутри правила нельзя ни сериализовать, ни сохранить, ни скомпилировать в SQL), `$regex` сложнее подстроки, `$size`, `$mod`, `$all`, `$nor`.

Если вы на что-то из этого опираетесь, честный путь — поднять это в поле, по которому сможет фильтровать и база: колонка `commentCount` вместо `$size`, булев флаг вместо `$where`.

## Проверки

```ts
// CASL
ability.can("update", subject("Post", post));
ability.can("read", "Post");             // по типу субъекта
ability.cannot("delete", subject("Post", post));
```

```ts
// Veto
ability.can("update", "post", post);
ability.can("read", "post");             // без строки
ability.cannot("delete", "post", post);
ability.authorize("delete", "post", post); // бросает ForbiddenError
```

Форма без строки отвечает на вопрос *возможно ли это хоть для какой-то строки* — она для решения, рисовать ли элемент управления, а не для защиты операции над конкретной строкой. Если строка есть — передайте её.

**Проверки по полям.** У `can("update", post, "title")` из CASL прямого близнеца нет. Veto разделяет вопросы: `ability.permittedFields("update", "post", post, fields)` для интерфейса и `ability.validatePayload(...)` на сервере — он возвращает проверенные данные либо точный список нарушений. См. [запись](./mutations.ru.md).

## React

`@casl/react` экспортирует `AbilityProvider`, `Can` и `useAbility`. У Veto то же самое — с одним структурным отличием, которое решает всё в Next.js.

```tsx
// CASL — провайдер принимает экземпляр ability
<AbilityProvider value={ability}>
	<App />
</AbilityProvider>
```

```tsx
// Veto — провайдер принимает правила, а это JSON
<AbilityProvider rules={ability.rules}>
	<App />
</AbilityProvider>
```

Это и есть лечение ошибки, на которую пользователи CASL наткнулись в Next 15 ([#999](https://github.com/stalniy/casl/issues/999)):

> Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.

`PureAbility` — экземпляр класса, границу он не пересекает. `ability.rules` — массив обычных объектов, поэтому пересекает, а клиент пересобирает ability из него.

Привязки берутся из фабрики, потому что типам нужен ваш `ac`:

```ts
// src/veto.ts
export const { AbilityProvider, useAbility, useCan, useSetRules, Can } =
	createVetoContext(ac);
```

### Пропсы `<Can>`

| CASL | Veto |
|---|---|
| `<Can I="update" a="Post">` | `<Can I="update" a="post">` |
| `<Can I="update" an="Article">` | `<Can I="update" a="article">` — `an` нет |
| `<Can I="update" this={post}>` | `<Can I="update" a="post" this={post}>` — ресурс называется всегда |
| `<Can do="update" on="Post">` | не поддерживается — используйте `I` / `a` |
| `<Can not>` | используйте `fallback` либо `useCan` и ветвление |
| `<Can passThrough>` | не поддерживается |
| `{({ isAllowed }) => ...}` | не поддерживается — используйте `useCan` |
| `field="title"` | `permittedFields` |
| — | `fallback={<ReadOnly />}` |
| — | `ability={ability}` — вообще без контекста |

### Серверные компоненты

Аналога в CASL нет, и ради этого переход в основном и затевается:

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>
```

Ни провайдера, ни контекста, ни `"use client"`, и в браузер не уезжает ничего — обе ветки решаются во время рендера. Ability собирайте один раз на запрос через `cache` из React.

### Перерисовки

`useAbility` в CASL будит всех потребителей при любой смене ability. У Veto — так же, и намеренно: хук отдаёт объект целиком. Когда нужен один ответ, `useCan` подписывается только на него:

```tsx
const canEdit = useCan("update", "post", post);
```

На списке из 50 закрытых строк, где меняется один вердикт, это 1 перерисовка вместо 50. А чтобы сменить пользователя вообще без перерисовки страницы, вместо передачи новых `rules` вниз используйте `useSetRules`.

## Запросы к базе

```ts
// CASL — через адаптер под вашу ORM
const posts = await prisma.post.findMany({ where: accessibleBy(ability).Post });
```

```ts
// Veto — обычное дерево условий
const condition = ability.where("read", "post");
```

`where()` возвращает данные, а не запрос. `@vetojs/drizzle` компилирует их в SQL с проверенной гарантией: запрос вернёт ровно те строки, которые разрешает `can()`. А без адаптера дерево можно обойти самому — в этом и отличие от ожидания релиза адаптера под следующий мажор вашей ORM.

## Поведение, которое отличается

Две вещи изменят то, что ваша политика делает на самом деле. Обе сделаны намеренно и обе играют на отказ.

**Значения не того типа.** В CASL условие может тихо посчитаться не в ту сторону:

```ts
// CASL: проходит, потому что "100" сравнивается как строка
ability.can("read", subject("Post", { views: "100" }));   // правило: { views: { $gt: 50 } }

// CASL: запрет не срабатывает на значении не того типа
ability.can("read", subject("Post", { secret: "true" })); // запрет: { secret: true }
```

Veto на присутствующее значение неверного типа отвечает **«неизвестно»**: `allow` не даёт ничего, а `deny` всё равно срабатывает. Испорченные данные способны только сузить доступ. См. [операторы](./operators.ru.md).

**Связи должны быть загружены.** Если правило читает `post.author.role`, а автора не загрузили, Veto бросит `RelationNotLoadedError`, а не ответит тихо «не совпало». Забытый `include` — это ошибка в запросе, а не изменение политики. См. [связи](./relations.ru.md).

## Правила из базы

Если правила хранятся в JSON, проверьте их на границе до сборки:

```ts
const result = parseRules(JSON.parse(raw));
if (!result.ok) throw new Error(result.errors.join("\n"));
const ability = buildAbility(ac, result.rules);
```

`buildAbility` принимает только правила, доказуемо прошедшие проверку, — из `createRules` либо из `parseRules`. См. [правила извне](./parse.ru.md).

## Порядок действий

1. Заменить алгебру типов одним вызовом `defineAbilities`; переименовать субъекты в ключи ресурсов в нижнем регистре.
2. Превратить билдер в функцию от пользователя, возвращающую массив; условия перенести под `where`.
3. Перевести операторы (убрать `$`); `$elemMatch` переписать как объявленную связь; найти замену для `$where`, `$regex`, `$size`, `$mod`, `$all`.
4. Убрать `subject()` везде и передавать имя ресурса вторым аргументом.
5. У провайдера заменить `value={ability}` на `rules={ability.rules}`; серверную защиту перевести на `@vetojs/react/server`.
6. Заменить `accessibleBy` на `ability.where()` плюс адаптер.
7. Перепрогнать тесты авторизации — поведение меняется именно на значениях неверного типа.
