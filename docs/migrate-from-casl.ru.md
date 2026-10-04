# Переход с CASL

**[English](migrate-from-casl.md) · [Русский](migrate-from-casl.ru.md)**

Сверено с `@casl/ability@7.0.1` и `@casl/react@7.0.1`.

В CASL ability — экземпляр класса, а объект помечают, изменяя его. В veto ability — замыкания над обычными данными, а имя ресурса передаётся аргументом:

```ts
// CASL
ability.can("update", subject("Post", post));

// veto
ability.can("update", "post", post);
```

Ваши объекты ничем не оборачиваются, а `ability.rules` — это JSON, который можно отправить куда угодно.

## Объявление предметной области

CASL требует писать алгебру типов руками:

```ts
type Abilities = ["read" | "update", "Post" | Post] | ["read", "User" | User];
const ability = createMongoAbility<MongoAbility<Abilities>>(rules);
```

veto принимает одно объявление и выводит остальное:

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

Ресурсы — это ключи объявления: `"post"`, а не `"Post"`.

## Правила

```ts
// CASL
const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
can("read", "Post", { status: "published" });
cannot("update", "Post", { status: "archived" });
const ability = build();
```

```ts
// veto
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	deny("update", "post", { where: { status: "archived" } }),
];

const ability = buildAbility(ac, policyFor(currentUser));
```

Условия лежат в `where`, отдельно от полей и значений ([запись](./mutations.ru.md)). Политика — функция, возвращающая массив: ни билдера, ни `build()`.

## Условия

| CASL | veto |
|---|---|
| `{ views: { $gt: 100 } }` | `{ views: { gt: 100 } }` |
| `$eq $ne $in $nin $gt $gte $lt $lte` | `eq ne in nin gt gte lt lte` |
| `{ $exists: false }` | `{ exists: false }` |
| `$and` `$or` `$not` | `and` `or` `not` |
| `{ $regex: /release/ }` | `{ contains: "release" }` — только подстрока |
| `{ comments: { $elemMatch: { spam: true } } }` | `{ comments: { some: { spam: true } } }` — объявленная [связь](./relations.ru.md) |

Аналогов нет у `$where`, `$regex` сложнее подстроки, `$size`, `$mod`, `$all`, `$nor`: ни одно из них не хранится как данные и не компилируется в SQL. Вынесите такое условие в колонку: `commentCount` вместо `$size`, флаг вместо `$where`. Чтобы сравнить два поля строки, используйте [`ref`](./conditions.ru.md#сравнение-двух-полей).

## Проверки

```ts
ability.can("update", "post", post);
ability.can("read", "post");               // без строки — для решений о рендере
ability.authorize("delete", "post", post); // бросает ForbiddenError
```

`can("update", post, "title")` из CASL становится `permittedFields("update", "post", post, fields)` для формы и `validatePayload` на сервере.

## React

```tsx
// CASL: провайдер принимает экземпляр
<AbilityProvider value={ability}>

// veto: провайдер принимает правила, а они — JSON
<AbilityProvider rules={ability.rules}>
```

Ability в CASL — экземпляр класса, поэтому Next отказывается передавать его из серверного компонента в клиентский ([casl#999](https://github.com/stalniy/casl/issues/999)). `ability.rules` проходит как есть. Привязки даёт `createVetoContext(ac)`.

| `<Can>` в CASL | `<Can>` в veto |
|---|---|
| `I="update" a="Post"`, `an="Article"` | `I="update" a="post"` |
| `I="update" this={post}` | `I="update" a="post" this={post}` — ресурс называется всегда |
| `not`, `passThrough`, render props | `fallback` или `useCan` с ветвлением |
| `field="title"` | `permittedFields` |
| — | `ability={ability}` — без контекста |

Серверный компонент берёт `Can` из `@vetojs/react/server`: ни провайдера, ни `"use client"`, обе ветки решаются на сервере. `useCan` перерисовывает, только когда меняется его единственный вердикт, а `useAbility` — как и в CASL — при любой смене.

## Запросы к базе

```ts
// CASL: адаптер под каждую ORM
const rows = await prisma.post.findMany({ where: accessibleBy(ability).Post });

// veto: дерево условий, которое компилирует @vetojs/drizzle
const filter = ability.where("read", "post");
```

## Где поведение отличается

**Значения не того типа.** CASL сравнит `{ views: "100" }` с `{ $gt: 50 }` и разрешит; `deny` по `secret: true` не сработает на `secret: "true"`. veto отвечает «неизвестно»: `allow` ничего не разрешает, `deny` срабатывает.

**Связи должны быть загружены.** Правило, читающее `post.author.role`, на посте без автора бросает `RelationNotLoadedError`, а не отвечает «не совпало».

## Чек-лист

1. Замените алгебру типов одним `defineAbilities`; переименуйте субъекты в ключи в нижнем регистре.
2. Превратите билдер в функцию от пользователя; перенесите условия в `where`.
3. Уберите `$` у операторов; перепишите `$elemMatch` связью; замените `$where`, `$regex`, `$size`, `$mod`, `$all`.
4. Уберите `subject()` и передавайте имя ресурса.
5. Дайте провайдеру `rules={ability.rules}`; закрывайте серверные компоненты через `@vetojs/react/server`.
6. Замените `accessibleBy` на `ability.where()` и адаптер.
7. Перезапустите тесты авторизации — ответы меняются на значениях не того типа.
