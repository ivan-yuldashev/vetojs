# Правила — `createRules`

**[English](create-rules.md) · [Русский](create-rules.ru.md)**

Правило говорит: разрешить или запретить это действие над этим ресурсом — для таких-то строк, по таким-то полям. `createRules(ac)` возвращает `allow` и `deny`, типизированные по вашим [объявлениям](./define-abilities.ru.md), а политика — это функция от пользователя, которая возвращает массив таких правил:

```ts
import { createRules } from "@vetojs/core";
import { ac } from "./abilities";

const { allow, deny } = createRules(ac);

const policyFor = (actor: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], { post: ["title", "status"] }, {
		where: { authorId: actor.id },
		values: { status: { in: ["draft"] } },
	}),
	deny("update", { post: ["featured"] }),
];
```

`actor.id` записывается в правило значением, так что на выходе обычный JSON.

## Что может сказать правило

```
allow(action, resource,             { where, when })
allow(action, { resource: fields }, { where, values, when })
```

| Часть | Отвечает на вопрос | С чем сверяется |
|---|---|---|
| `where` | какие строки — [условия](./conditions.ru.md), [связи](./relations.ru.md) | со строкой |
| `fields`, в цели | какие поля можно писать; ресурс без списка — все поля | с входящими данными |
| `values` | какие значения могут принимать эти поля | с входящими данными |
| `when` | участвует ли правило в этом запросе — [окружение](./define-abilities.ru.md#окружение-запроса) | с запросом |

«Боб правит свои посты» — это `where`. «Боб правит заголовок, но не `featured`» — `fields`. «Боб меняет статус, но только на `draft`» — `values`. Как последние два решают судьбу записи, описано в разделе [запись](./mutations.ru.md).

`action` — одно действие, непустой список или `"manage"`: все действия ресурса, включая добавленные позже. Если разрешение не должно расти вместе с объявлением, перечислите действия явно — `allow([...ac.post.actions], "post")`. `manage` пишется только в правилах; проверка называет то действие, о котором спрашивает.

## Всё сверяется с объявлениями

```ts
allow("archive", "post");                               // ✗ у "post" нет действия "archive"
allow("read", "posts");                                 // ✗ такого ресурса нет
allow("read", "post", { where: { bogus: 1 } });         // ✗ такого поля нет
allow("read", "post", { where: { views: "many" } });    // ✗ views — число
allow("read", "post", { where: { title: { gt: 5 } } }); // ✗ gt не для строк
```

Пустое условие и пустой список действий тоже не компилируются: пустой `where` накрыл бы все строки там, где имелись в виду некоторые, а пустой `deny` ничего бы не запрещал.

## Хранимая форма

`createRules` сразу компилирует короткую запись и возвращает вот это:

```ts
type Rule = {
	effect: "allow" | "deny";
	action: string | [string, ...string[]];
	resource: string;
	where?: ConditionNode;
	fields?: readonly [string, ...string[]];
	values?: FieldConditionNode;
	when?: WhenNode;
};
```

Такое правило без потерь проходит через `JSON.stringify`, базу и сеть. Обратно его читают через [`parseRules`](./parse.ru.md).

`buildAbility` принимает только проверенные правила — из этих фабрик или из `parseRules`, поэтому литерал, написанный руками, не компилируется:

```ts
buildAbility(ac, [{ effect: "allow", action: "read", resource: "post" }]); // ✗
```

Тесту, которому нужно намеренно сломанное правило, остаётся `as CheckedRules`.

## Одно правило на роль, а не на тенант

Если повторять одни и те же правила для каждого членства, массив растёт вместе с числом тенантов — и именно он уезжает на клиент:

```ts
// ✗ копия каждого правила на каждый воркспейс
actor.memberships.flatMap(({ workspaceId }) => [
	allow("read", "post", { where: { blog: { workspace: { id: workspaceId } } } }),
]);

// ✓ одно правило со списком воркспейсов, которые покрывает роль
const writer = actor.memberships
	.filter((m) => m.role !== "viewer")
	.map((m) => m.workspaceId);

allow("read", "post", { where: { blog: { workspace: { id: { in: writer } } } } });
```

Вердикты те же. У пользователя в 50 воркспейсах 338 правил и 64 kB JSON превращаются в 13 правил и 4 kB.

## Почему так устроено

- **Политика — это данные.** Протестировать её — значит сравнить массивы, отправить — `JSON.stringify`.
- **`createRules` получает `ac` значением**, потому что при компиляции `where` надо знать, какие ключи — связи.
- **Поле называется непустой строкой.** Ключи записи — строки, так что символ или числовой ключ никогда бы не совпал.

## Исходники

[`create/create-rules.ts`](../packages/core/src/create/create-rules.ts) · [`model/rule.ts`](../packages/core/src/model/rule.ts) · [тесты](../packages/core/tests/create/create-rules.test.ts)
