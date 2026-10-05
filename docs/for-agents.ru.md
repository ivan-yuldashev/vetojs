# Для агентов

**[English](for-agents.md) · [Русский](for-agents.ru.md)**

Всё, что нужно, чтобы писать правильный код на veto, — на одной странице. В последнем разделе — ошибки, которые выглядят правдоподобно, но неверны.

## Установка

```sh
npm install @vetojs/core            # движок; гвард — @vetojs/core/guard
npm install @vetojs/react           # по желанию: <Can>, useCan, useAbility
npm install @vetojs/drizzle         # по желанию: политика как SQL WHERE
```

Только ESM, Node 20+. `@vetojs/core` — peer-зависимость двух других пакетов; React 18+.

## Весь путь

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published"; featured: boolean }>(),
			actions: ["read", "update", "publish"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
	deny("update", { post: ["featured"] }),
];

const ability = buildAbility(ac, policyFor(currentUser)); // один раз на запрос
ability.can("update", "post", post);
```

## `@vetojs/core`

| Экспорт | Сигнатура | Назначение |
|---|---|---|
| `defineAbilities` | `({ resources, env? }) => AC` | ресурсы, действия, связи; `env: shape<E>()` объявляет то, что читает `when` правила. У ресурса без строк `schema` не пишут |
| `shape<T>()` | `() => Schema<T>` | только тип. Схема Zod / Valibot / ArkType вместо него заставит `validate` проверять данные; не Yup — он асинхронный |
| `createRules` | `(ac) => { allow, deny }` | типизированные фабрики правил |
| `buildAbility` | `(ac, rules) => Ability` | объект, у которого спрашивают. Если объявлено `env`, возвращает `AbilityForEnv`, у которого нечего спросить до привязки |
| `withEnv` | `(ability, env) => Ability` | привязывает окружение одного запроса; те же ключи и значения возвращают тот же ability |
| `parseRules` | `(json) => { ok: true, rules } \| { ok: false, errors }` | проверяет форму недоверенного JSON правил |
| `markLoaded` | `(row, relation, value) => row` | `(row, relations) => row` | копия с заданной связью; `null` — загружено, но пусто. С формой `{ author: null, comments: [] }` заполняет связи, которые выбросил сериализатор |
| `ForbiddenError` | класс | `.action`, `.resource`, `.violations?`; проверяйте через `ForbiddenError.is(error)` |
| `RelationNotLoadedError` | класс | `.relation` |
| `ConditionOperator` | константный объект | тринадцать операторов — для кода, который обходит `where()` |

| Метод `ability` | Возвращает | Для чего |
|---|---|---|
| `can(action, resource, row?)` | `boolean` | ветвление. Без строки: может ли быть разрешено для какой-нибудь строки |
| `cannot(action, resource, row?)` | `boolean` | ранний выход |
| `authorize(action, resource, row?)` | `void`, бросает `ForbiddenError` | границы. Без строки пропускает только `allow` без `where`, и ни один `deny` не должен смотреть в строку |
| `canMutate(action, resource, row)` | `boolean` | можно ли писать в эту строку; при создании — `undefined` |
| `validatePayload(action, resource, row, data)` | `{ ok: true, data } \| { ok: false, violations }` | можно ли записать эти данные |
| `permittedFields(action, resource, row, fields)` | подмножество `fields` | форма |
| `where(action, resource)` | `ConditionNode` | фильтр для базы |
| `validate(resource, data)` | `{ ok: true, value } \| { ok: false, issues }` | проверка по схеме |
| `rules` | `CheckedRules` | отправить на клиент |

`"manage"` в правиле означает все действия ресурса, включая добавленные позже; проверка его не называет. `buildAbility(ac, rules, { onDecision })` сообщает о каждом решении — см. [ability](./ability.ru.md#журнал-решений).

## Как писать условия

```ts
where: {
	status: "published",                  // eq
	views: { gte: 100 },                  // number, Date: gt gte lt lte
	title: { contains: "release" },       // string
	authorId: { in: ["u1", "u2"] },
	deletedAt: { exists: false },
	tags: { has: "release" },             // поле-массив: has | hasAny | hasAll
	spent: { lte: { ref: "limit" } },     // другое поле той же строки
	author: { role: "admin" },            // связь «один к одному»
	comments: { none: { spam: true } },   // «один ко многим»: some | every | none
	or: [{ pinned: true }, { views: { gt: 1000 } }],
}
```

Соседние ключи объединяются через AND, по одному оператору на поле. Значение не того типа, `NaN`, объект, сравниваемый по значению, или поле, которого в строке нет, дают **«неизвестно»**: `allow` ничего не разрешает, `deny` срабатывает. `null` — значение: со всем, кроме `null`, это просто «нет». `values` принимает только поля и `and`; `when` — поля окружения и группы, без связей.

## Охрана входной точки

```ts
import { createGuard } from "@vetojs/core/guard";
import { ac, policyFor } from "./abilities";
import { getActor } from "./auth";

const withPermission = createGuard({ ac, getActor, policy: policyFor });

const publish = withPermission(
	{
		action: "publish",
		resource: "post",
		load: (args: { id: string; status: "draft" | "published" }) => loadPost(args.id),
		payload: (args: { id: string; status: "draft" | "published" }) => ({ status: args.status }),
	},
	async (ctx) => `published ${ctx.row.id}`,
);
```

Одна и та же обёртка охраняет server action, HTTP-обработчик и вызов инструмента; обёрнутая функция сохраняет сигнатуру. `ctx.row` — то, что вернул `load` (пустой `load` получает отказ), `ctx.payload` — проверенные данные. Если объявлено `env`, `createGuard` принимает ещё и `getEnv(...args)`. Для инструмента без таблицы — письмо, платёж — `load` собирает строку из аргументов; без строки `allow` с `where` ничего не разрешает. Отказ бросает `ForbiddenError`; положите `error.violations` в результат инструмента, чтобы модель исправила аргументы. См. [агенты](./agents.ru.md).

## `@vetojs/react`

```ts
// src/authz.ts — вызовите фабрику один раз, импортируйте отсюда
import { createVetoContext } from "@vetojs/react";
import { ac } from "./abilities";

export const { AbilityProvider, useAbility, useCan, useSetRules, Can } = createVetoContext(ac);
```

```tsx
<AbilityProvider rules={ability.rules}>
	<Can I="update" a="post" this={post} fallback={<Disabled />}>
		<EditButton />
	</Can>
</AbilityProvider>
```

| Привязка | Для чего |
|---|---|
| `Can` из `@vetojs/react/server` | серверный компонент; принимает `ability`, в браузер ничего не уходит |
| `<Can>` из фабрики | клиентский компонент |
| `useCan(action, resource, row?)` | один вердикт, перерисовка только при его смене |
| `useAbility()` | `permittedFields`, фильтрация списка, несколько проверок |
| `useSetRules()` | смена пользователя без перерисовки страницы |

Если объявлено `env`: `createVetoContext(ac, withEnv)`, а провайдер принимает `env` рядом с `rules`.

## Фильтрация в базе

```ts
const rows = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, id)));
```

`schema` получают из `defineTables(ac, { post: posts, … })` в `@vetojs/drizzle`. Фильтр выбирает ровно те строки, что разрешает `can()`; дополнительные предикаты только сужают. Без адаптера обращайтесь с `ability.where()` как с данными.

## Правила в виде JSON

Когда вы порождаете политику, а не вызываете её, — для админки или базы, — выдавайте хранимую форму и проверяйте её:

```ts
const proposed = [
	{
		effect: "allow",
		action: ["update", "publish"],
		resource: "post",
		where: { field: "authorId", op: "eq", value: "u1" },
		fields: ["status"],
		values: { field: "status", op: "in", value: ["draft"] },
	},
];

const result = parseRules(proposed);
```

`ok: false` перечисляет ошибки с путями, например `rules[0].where.op: unknown operator "regex"`. Имена не проверяются: выдуманное действие или ресурс проходит и потом ничему не соответствует, выдуманная связь бросает исключение на первой же проверке. Берите имена из объявлений. Узел называет ровно одно из: поле, `and`, `or`, `not`, `relation`.

## Ошибки, которых стоит избегать

**Голый массив на поле-массиве.**

```ts
where: { tags: ["a", "b"] }             // ✗ не проходит по типам
where: { tags: { in: ["a", "b"] } }     // ✗ `in` — для скалярных полей
where: { tags: { hasAny: ["a", "b"] } } // ✓
```

**Сырой JSON в `buildAbility`.** `buildAbility(ac, JSON.parse(raw))` компилируется — `JSON.parse` возвращает `any` — и пропускает проверку. Идите через `parseRules` и передавайте `result.rules`, когда `result.ok`.

**Проверка без строки вместо проверки строки.** `can("update", "post")` — «да», если можно править *какой-нибудь* пост. Передавайте строку, если операция её касается.

**Связь, которую читает правило, не загружена.** `can()` бросает `RelationNotLoadedError`. Загрузите её — `with: { author: true }` — а экземпляры классов из ORM превратите в объекты через `structuredClone`.

**Проверка формы гвардом.** Он проверяет права, а не схемы; аргументы валидируйте отдельно.

**Спрятанная кнопка вместо защиты.** Сервер проверяет каждое действие.

**`instanceof ForbiddenError`.** Две копии пакета его ломают; пишите `ForbiddenError.is(error)`.

**Поиск опции, меняющей приоритет.** `deny` всегда побеждает, а всё, что не разрешено, запрещено; именно поэтому фильтр в SQL точен.

## Вся документация

Страницы по каждому концепту, на английском и русском: [docs/README.ru.md](./README.ru.md).
