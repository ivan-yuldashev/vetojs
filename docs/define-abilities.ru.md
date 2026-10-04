# Объявление ресурсов — `defineAbilities`

**[English](define-abilities.md) · [Русский](define-abilities.ru.md)**

Одно объявление говорит, какие ресурсы есть, что с ними можно делать и как они связаны. Из него выводятся все типы дальше по коду — имена ресурсов, действия, формы строк.

```ts
import { defineAbilities, shape } from "@vetojs/core";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "create", "update", "delete", "publish"],
			relations: {
				blog: { resource: "blog", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		blog: { schema: shape<Blog>(), actions: ["read", "update"] },
		comment: { schema: shape<Comment>(), actions: ["read", "create", "delete"] },
	},
});
```

| Поле | Что означает |
|---|---|
| `schema` | форма строки. `shape<T>()` несёт только тип и ничего не проверяет; [Standard Schema](#проверка-данных-настоящей-схемой) ещё и валидирует. Необязательно |
| `actions` | что можно делать с ресурсом |
| `relations` | связи с объявленными ресурсами: `{ resource, kind: "one" \| "many" }` |

В рантайме `defineAbilities` возвращает `resources` как есть. Вся польза — в типе:

```ts
type AC = typeof ac;

ResourceName<AC>;           // "post" | "blog" | "comment"
ActionFor<AC, "post">;      // объявленные действия и "manage" — то, что называет правило
DeclaredAction<AC, "post">; // объявленные действия — то, что называет проверка
ShapeOf<AC, "post">;        // Post
```

## Окружение запроса

Бывает, что решение зависит не от строки, а от запроса: от часа, от IP вызывающего, от того, прошла ли сессия MFA и действует ли агент. Что несёт запрос, объявляется в `env` рядом с `resources`:

```ts
import { defineAbilities, shape } from "@vetojs/core";

const ac = defineAbilities({
	env: shape<{ hour: number; mfa: boolean }>(),
	resources: {
		invoice: { schema: shape<{ id: string; total: number }>(), actions: ["read", "delete"] },
	},
});
```

Эти ключи правило читает в своём [`when`](./create-rules.ru.md#что-может-сказать-правило), а [`withEnv`](./ability.ru.md#withenv--окружение-запроса) подставляет значения одного запроса. Без `env` написать правило с `when` нельзя.

## Ресурс без строк

Экран, отчёт, фоновая задача — то, о чём решает политика, но за чем нет записи. `schema` не пишут:

```ts
const ac = defineAbilities({ resources: { report: { actions: ["view", "export"] } } });
const { allow } = createRules(ac);
const ability = buildAbility(ac, []);

ability.can("view", "report", { id: "r1" });        // ✗ передавать нечего
allow("view", "report", { where: { id: "r1" } });   // ✗ и сравнивать не с чем
```

`can("view", "report")` отвечает по правилам как обычно. Карта Drizzle говорит то же самое через `defineTables(ac, { report: null })`. Экран, у которого есть ключ — id воркспейса из маршрута, — всё-таки имеет строку; см. [экраны и вкладки](./react.ru.md#экраны-и-вкладки).

## Проверка данных настоящей схемой

Передайте Standard Schema вместо `shape<T>()`, и форма выведется из неё:

```ts
import { z } from "zod";

const ac = defineAbilities({
	resources: {
		post: {
			schema: z.object({ id: z.string(), title: z.string().min(3), status: z.enum(["draft", "published"]) }),
			actions: ["read", "update"],
		},
	},
});

ability.validate("post", input); // { ok: true, value } | { ok: false, issues }
```

`validate` отвечает, *валиден ли этот пост*; [`validatePayload`](./mutations.ru.md) — *можно ли этому пользователю его записать*. Аргументам, которые модель придумала для вызова инструмента, нужны обе проверки.

Схема должна валидировать синхронно: Zod, Valibot и ArkType подходят, Yup — нет: у него асинхронная проверка, и `validate` бросит исключение. Ни правила, ни проверки к схеме не обращаются.

## Почему так устроено

- **Ничего не пишется дважды.** Литералы действий захватывает `const`-параметр типа, а у каждого ресурса своя форма.
- **Имена проверяются там, где пишутся правила.** `createRules` отвергает действие, ресурс или поле, которых вы не объявили. Правила, пришедшие JSON, проверяются только по форме — см. [parse](./parse.ru.md#имена-не-проверяются).

## Исходники

[`create/define-abilities.ts`](../packages/core/src/create/define-abilities.ts) · [`create/schema.ts`](../packages/core/src/create/schema.ts) · [тесты](../packages/core/tests/create/define-abilities.test.ts)
