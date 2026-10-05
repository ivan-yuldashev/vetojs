# ⚡ @vetojs/core

> Право пишется один раз: те же правила отвечают на `can()`, становятся `WHERE` запроса, проверяют запись по полям и охраняют server action, HTTP-обработчик и вызов инструмента ИИ-агентом.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Fcore)](https://www.npmjs.com/package/@vetojs/core)
[![License](https://img.shields.io/npm/l/%40vetojs%2Fcore)](https://github.com/ivan-yuldashev/vetojs/blob/main/LICENSE)
[![Socket](https://socket.dev/api/badge/npm/package/@vetojs/core)](https://socket.dev/npm/package/@vetojs/core)

Движок [`@vetojs`](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md) — **[English](README.md) · [Русский](README.ru.md)**.

Авторизация отвечает на вопрос «можно ли *этому* пользователю сделать *это* с *этой* строкой». Здесь ответ даёт политика — чистая функция, которая принимает пользователя (или другой контекст) и возвращает массив правил в обычном JSON.

Один и тот же массив закрывает все места, где возникает этот вопрос: проверку в коде (`ability.can("update", "post", post)`), условие `WHERE` для выборки из базы, список полей, которые пользователю позволено записать, и вызов инструмента, который агент делает от имени пользователя.

## Почему @vetojs/core

- **Одна политика на все входные точки.** `can()` в коде, `where()` для запроса, `validatePayload` для записи, `createGuard` вокруг server action, HTTP-обработчика или вызова инструмента агентом — все читают один и тот же массив.
- **Запрос возвращает то, что разрешает проверка.** `ability.where()` отдаёт дерево условий, из которого компилируется `WHERE`, а тест требует, чтобы оно выбирало те же строки, что и `can()`, — в том числе на грязных данных.
- **Отказ называет поле.** `violations: [{ field, reason }]` — клиенту API есть чем ответить, а модели — что исправить в аргументе, вместо того чтобы повторять вызов.
- **Агенту доступно только то, что доступно его человеку.** Гвард загружает строку, которую назвала модель, и сверяет её с политикой человека, за которого действует агент, — до того, как запустится ваш обработчик.
- **Кривые данные сужают доступ, но не расширяют.** Поле не того типа или пропавший ключ дают вердикт «неизвестно»: `allow` при нём ничего не разрешает, `deny` всё равно срабатывает.

---

## Quick Start

### 1. Установка

```sh
npm install @vetojs/core
# или
pnpm add @vetojs/core
```

Только ESM, Node.js 20 и новее.

### 2. Объявите ресурсы и политику

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";
import type { ActionFor, ResourceName } from "@vetojs/core";

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<{ id: string; authorId: string; status: "draft" | "published" }>(),
			actions: ["read", "update", "publish"],
			relations: { author: { resource: "user", kind: "one" } },
		},
		user: { schema: shape<{ id: string; role: string }>(), actions: ["read"] },
	},
});

const { allow } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
];

const ability = buildAbility(ac, policyFor({ id: "u_1" }));
```

### 3. Спрашивайте — типы уже выведены

Список ресурсов и список действий для каждого из них редактор берёт прямо из объявления:

```ts
type Resources = ResourceName<typeof ac>;
//   ^? "post" | "user"

type PostActions = ActionFor<typeof ac, "post">;
//   ^? "read" | "update" | "publish" | "manage"

ability.can("publish", "post", post);
//           ^| автодополнение подставит эти три и никаких других
```

`manage` добавляется к каждому ресурсу для правил — это подстановочное действие, покрывающее все остальные. Вопрос называет действие, о котором спрашивает, поэтому `can` предлагает только объявленные, без `manage`.

Возвращаемые типы выводятся оттуда же:

```ts
const filter = ability.where("read", "post");
//    ^? ConditionNode<{ id: string; authorId: string; status: "draft" | "published" }>

const writable = ability.permittedFields("update", "post", post, ["status"]);
//    ^? "status"[]

const forClient = ability.rules;
//    ^? CheckedRules — плоский JSON, готов уехать в пропсы
```

Опечатка в действии, ресурсе, поле или значении — ошибка компиляции, а не отказ в проде:

```ts
ability.can("archive", "post");
//          ^^^^^^^^^ ✗ Argument of type '"archive"' is not assignable to parameter of type 'ActionFor<…, "post">'

allow("read", "post", { where: { statuz: "published" } });
//                               ^^^^^^ ✗ Object literal may only specify known properties, but 'statuz' does not exist… Did you mean to write 'status'?

allow("read", "post", { where: { status: "archived" } });
//                                       ^^^^^^^^^^ ✗ Type '"archived"' is not assignable to type '"draft" | "published" | ScalarOperators<…>'
```

## Core API

- [`defineAbilities`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/define-abilities.ru.md) — единственный источник правды. Из него выводятся формы строк, действия и связи.
- `shape<T>()` — объявляет форму ресурса. Для runtime-проверок сюда же передаётся любая схема, совместимая со [Standard Schema](https://standardschema.dev): Zod, Valibot, ArkType.
- [`createRules(ac)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/create-rules.ru.md) — отдаёт `allow` и `deny`, сверенные с вашей схемой.
- [`buildAbility(ac, rules)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/ability.ru.md) — превращает плоский массив в `ability`.
- [`withEnv(ability, env)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/ability.ru.md#withenv--окружение-запроса) — подставляет окружение одного запроса — час, IP, прошла ли сессия MFA, — когда в объявлениях есть `env`, а правила читают его в `when`.
- [`parseRules(json)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/parse.ru.md) — проверяет недоверенный JSON правил на границе.
- [`markLoaded`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/relations.ru.md) — копия строки с заданной связью или с восстановленными связями, которые выбросил сериализатор.
- `ConditionOperator` — `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`, `has`, `hasAny`, `hasAll`; `{ ref: "field" }` на месте значения [сравнивает два поля](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/conditions.ru.md#сравнение-двух-полей) строки.
- `ForbiddenError`, `RelationNotLoadedError` — два единственных класса в пакете.

Что умеет `ability`:

| Метод | Отвечает на вопрос |
|---|---|
| `can`, `cannot`, `authorize` | можно ли действие — вообще или с этой строкой |
| `canMutate`, [`validatePayload`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/mutations.ru.md) | можно ли записать эти поля с этими значениями |
| `permittedFields` | какие поля оставить активными в форме |
| [`where`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/where.ru.md) | какое условие отдать базе |
| `validate` | подходят ли входящие данные под схему ресурса |
| `rules` | что отправить на клиент |

### Отказ называет поле

`validatePayload` смотрит каждый ключ payload и на отказе возвращает `violations` — по нему видно, что именно поправить:

```ts
const result = ability.validatePayload("update", "post", post, { status: "published" });
//    ^? PayloadResult<Post> — { ok: true; data } | { ok: false; violations }

if (!result.ok) {
	result.violations;
	//     ^? Violation[] — [{ field: "status", reason: … }], публичное имя типа PayloadViolation
}
```

Клиенту API по этому ответу видно, что исправить; агенту — чем заменить аргумент, чтобы не повторять тот же вызов.

## Гвард: одна обёртка на все входные точки

Вторая точка входа — [`@vetojs/core/guard`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.ru.md). `createGuard` один раз описывает, как найти пользователя и какую политику ему собрать:

```ts
import { createGuard } from "@vetojs/core/guard";
import { ac, policyFor } from "./abilities";
import { getActor } from "./auth";

export const withPermission = createGuard({ ac, getActor, policy: policyFor });
```

Если объявлено `env`, конфиг принимает ещё и `getEnv`: он читает окружение каждого вызова из аргументов обёрнутой функции.

Дальше каждое действие называет только две вещи: что оно делает и с каким ресурсом. Обёртка находит пользователя, загружает строку, проверяет payload и лишь потом пускает в обработчик — одинаково для server action, [HTTP-обработчика](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/http.ru.md) и [вызова инструмента агентом](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/agents.ru.md).

```ts
const publishPost = withPermission(
	{ action: "publish", resource: "post", load: (id: string) => loadPost(id) },
	async (ctx, id: string) => {
		ctx.row;
		//  ^? Post — `load` объявлен, поэтому строка есть, а не «может быть»
		ctx.actor;
		//  ^? { id: string } — то, что вернул getActor
		return { id, status: ctx.row.status };
	},
);
```

Обёрнутая функция сохраняет исходную сигнатуру: `(id: string) => Promise<…>`. Вызывающий код не меняется.

## Кривые данные и незагруженные связи

Поле не того типа, поле, которого в строке нет, `NaN` или объект, сравниваемый по значению, дают **«неизвестно»**: `allow` ничего не разрешает, `deny` срабатывает ([операторы](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/operators.ru.md)).

Правилу, которое читает `post.author.role`, нужен загруженный автор. Без него `can()` бросает `RelationNotLoadedError`, а не отвечает «не совпало»:

```ts
const post = await db.query.posts.findFirst({ with: { author: true } });
ability.can("update", "post", post);
```

`undefined` — не загружено, `null` — загружено и пусто. Строке, собранной руками, нужен ключ связи — `{ ...post, author }`, — а экземпляры классов из ORM превращают в объекты через `structuredClone` ([связи](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/relations.ru.md)).

## Как это устроено

- **Типы выводятся сами.** Одно объявление `defineAbilities` — дальше действия, ресурсы, поля и операторы подставляет редактор. Ручных дженериков нет, `any` нет.
- **Мало весит и ничего не тянет.** Собрать ability и проверить строку — 3.7 kB gzip; вместе с валидацией пришедших правил — 5.4 kB. 0 зависимостей, только ESM, `sideEffects: false`.
- **Скрытого состояния нет.** Кроме двух классов ошибок, классов в пакете нет. `buildAbility` ничего не мутирует и ничего не кеширует между запросами.
- **Работает везде, где есть JavaScript.** Node, браузер, Cloudflare Workers, Vercel Edge, Deno, Bun — один и тот же бандл, без платформенных веток.

## Сравнение с CASL

CASL — самая распространённая библиотека авторизации в экосистеме. Если вы выбираете между ними или переезжаете:

| Задача | CASL | @vetojs/core |
|---|---|---|
| Зависимости | 1 прямая, 4 в дереве | **0** |
| Собрать ability и проверить строку | 6.3 kB gzip | **3.7 kB gzip** |
| Отдать права на клиент | пересобрать: `createMongoAbility(rules)` | тот же массив: `buildAbility(ac, rules)` |
| Объявить действия и ресурсы | перечислить парами в дженерике | выводятся из `defineAbilities` |
| Отфильтровать выборку в базе | адаптер под ORM, для SQL его нет | `ability.where()` отдаёт дерево условий, из него собирается `WHERE` |
| RSC и edge-рантаймы | — | поддерживаются |

Цифры собраны [тестом](https://github.com/ivan-yuldashev/vetojs/blob/main/packages/core/tests/readme-size.test.ts): обе библиотеки проходят esbuild, минификацию и gzip; сверка проведена на `@casl/ability@7.0.1`. [Переход с CASL](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/migrate-from-casl.ru.md) сопоставляет API построчно.

## Contributing

Не хватает оператора, не ложится сценарий, мешает формулировка в ошибке — [расскажите об этом в issue](https://github.com/ivan-yuldashev/vetojs/issues/new). Пожелания к API читаются наравне с баг-репортами и влияют на то, что делается следующим.

Порядок работы описан в [CONTRIBUTING.md](https://github.com/ivan-yuldashev/vetojs/blob/main/CONTRIBUTING.md), сообщения об уязвимостях — в [SECURITY.md](https://github.com/ivan-yuldashev/vetojs/blob/main/SECURITY.md).

## Что дальше

- **[Документация](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/README.ru.md)** — подробные страницы по каждому концепту: от объявления ресурсов до SQL-фильтрации.
- **[Агенты](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/agents.ru.md)** — как охранять вызовы инструментов той же политикой, пополевой отказ, по которому модель исправляется, и действия, за которыми нет строки.
- **[Для агентов](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.ru.md)** и **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — весь API на одной странице, под контекст ИИ-ассистента: дайте ссылку Claude, Cursor или Copilot.
- **Примеры** — три рабочих демо на одной мультитенантной модели: [react-spa](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/react-spa), [next-app](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/next-app) и [drizzle-pg](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/drizzle-pg), где `can()` и скомпилированный `WHERE` сверяются построчно.

## Лицензия

MIT
