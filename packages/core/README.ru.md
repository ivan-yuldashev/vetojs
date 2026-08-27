# ⚡ @vetojs/core

> Авторизация для TypeScript: кто из пользователей что может делать в вашем приложении. Правила — обычный JSON, типы выводятся сами, 0 зависимостей.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Fcore)](https://www.npmjs.com/package/@vetojs/core)
[![Bundle size](https://img.shields.io/bundlejs/size/%40vetojs%2Fcore)](https://bundlejs.com/?q=%40vetojs%2Fcore)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@vetojs/core?activeTab=dependencies)
[![License](https://img.shields.io/npm/l/%40vetojs%2Fcore)](https://github.com/ivan-yuldashev/vetojs/blob/main/LICENSE)
[![Socket](https://socket.dev/api/badge/npm/package/@vetojs/core)](https://socket.dev/npm/package/@vetojs/core)

Движок [`@vetojs`](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md) — **[English](README.md) · [Русский](README.ru.md)**.

Авторизация отвечает на вопрос «можно ли *этому* пользователю сделать *это* с *этой* строкой». Здесь ответ даёт политика — чистая функция, которая принимает пользователя (или другой контекст) и возвращает массив правил в обычном JSON.

Один и тот же массив закрывает три места сразу: проверку в коде (`ability.can("update", "post", post)`), условие `WHERE` для выборки из базы и список полей, которые пользователю позволено записать.

## Почему @vetojs/core

- **Типы выводятся сами.** Одно объявление `defineAbilities` — дальше действия, ресурсы, поля и операторы подставляет редактор. Ручных дженериков нет, `any` нет.
- **Ноль оверхеда.** 0 зависимостей, только ESM, `sideEffects: false`. Собрать ability и проверить строку — 4.0 kB gzip; вместе с валидацией пришедших правил — 5.4 kB.
- **Работает везде, где есть JavaScript.** Node, браузер, Cloudflare Workers, Vercel Edge, Deno, Bun — один и тот же бандл, без платформенных веток.
- **Никакого скрытого состояния.** Кроме двух классов ошибок, классов в пакете нет. `buildAbility` ничего не мутирует и ничего не кеширует между запросами.
- **Ассистент разберётся сам.** Весь API собран на одной странице — [docs/for-agents.ru.md](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.ru.md) и [llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt): дайте ссылку Claude, Cursor или Copilot, и подсказки будут по делу.

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
//           ^| автодополнение подставит эти четыре и никаких других
```

`manage` добавляется к каждому ресурсу — это подстановочное действие, покрывающее все остальные.

Возвращаемые типы выводятся оттуда же:

```ts
const filter = ability.where("read", "post");
//    ^? ConditionNode<{ id: string; authorId: string; status: "draft" | "published" }>

const writable = ability.permittedFields("update", "post", ["status"]);
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

## Чем отличается от CASL

CASL — самая распространённая библиотека авторизации в экосистеме, поэтому сравнение с ней:

| Задача | CASL | @vetojs/core |
|---|---|---|
| Зависимости | 1 прямая, 4 в дереве | **0** |
| Собрать ability и проверить строку | 6.3 kB gzip | **4.0 kB gzip** |
| Отдать права на клиент | пересобрать: `createMongoAbility(rules)` | тот же массив: `buildAbility(ac, rules)` |
| Объявить действия и ресурсы | перечислить парами в дженерике | выводятся из `defineAbilities` |
| Отфильтровать выборку в базе | адаптер под ORM, для SQL его нет | `ability.where()` отдаёт дерево условий, из него собирается `WHERE` |
| RSC и edge-рантаймы | — | поддерживаются |

Цифры собраны [тестом](https://github.com/ivan-yuldashev/vetojs/blob/main/packages/core/tests/readme-size.test.ts): обе библиотеки проходят esbuild, минификацию и gzip; сверка проведена на `@casl/ability@7.0.1`. [Переход с CASL](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/migrate-from-casl.ru.md) сопоставляет API построчно.

## Core API

Основной экспорт — четыре функции и один объект.

- [`defineAbilities`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/define-abilities.ru.md) — единственный источник правды. Из него выводятся формы строк, действия и связи.
- `shape<T>()` — объявляет форму ресурса. Для runtime-проверок сюда же передаётся любая схема, совместимая со [Standard Schema](https://standardschema.dev): Zod, Valibot, ArkType.
- [`createRules(ac)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/create-rules.ru.md) — отдаёт `allow` и `deny`, сверенные с вашей схемой.
- [`buildAbility(ac, rules)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/ability.ru.md) — превращает плоский массив в `ability`.
- [`parseRules(json, ac)`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/parse.ru.md) — проверяет недоверенный JSON правил на границе.
- [`markLoaded`](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/relations.ru.md) — помечает связь загруженной, когда данные собраны руками, а не ORM.
- `ConditionOperator` — `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`, `has`, `hasAny`, `hasAll`.
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

export const withPermission = createGuard({
	ac: accessControl,
	getActor: currentActor,
	policy: policyFor,
});
```

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

## Предсказуемое поведение на плохих данных

В базе встречается `NULL`, а с клиента приходит текст вместо числа. Когда честно ответить на условие нельзя, движок не угадывает, а возвращает вердикт **«неизвестно»**.

Он безопасен в обе стороны: `allow` при нём ничего не разрешает, `deny` всё равно срабатывает. Плохие данные могут только сузить доступ ([подробнее об операторах](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/operators.ru.md)).

### Со связями движок строже

Если правило смотрит на `post.author.role`, автор обязан быть загружен вместе с постом. Забытый `include` — это ошибка запроса, а не повод молча поменять права, поэтому `can()` не отвечает «не совпало», а **бросает** `RelationNotLoadedError`:

```ts
const post = await db.query.posts.findFirst({ with: { author: true } });
ability.can("update", "post", post);
```

Конвенция та же, что у ORM: `undefined` — связь не загружена, `null` — загружена и пуста.

Если строку вы собрали не запросом, а руками — склеили из двух ответов, достали из кеша, — движку об этом надо сказать: `markLoaded(post, "author", author)` вернёт копию с пометкой «автор загружен». Без неё связь считается незагруженной, и `can()` бросит исключение ([подробнее о связях](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/relations.ru.md)).

## Contributing

Не хватает оператора, не ложится сценарий, мешает формулировка в ошибке — [расскажите об этом в issue](https://github.com/ivan-yuldashev/vetojs/issues/new). Пожелания к API читаются наравне с баг-репортами и влияют на то, что делается следующим.

Порядок работы описан в [CONTRIBUTING.md](https://github.com/ivan-yuldashev/vetojs/blob/main/CONTRIBUTING.md), сообщения об уязвимостях — в [SECURITY.md](https://github.com/ivan-yuldashev/vetojs/blob/main/SECURITY.md).

## Что дальше

- **[Документация](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/README.ru.md)** — подробные страницы по каждому концепту: от объявления ресурсов до SQL-фильтрации.
- **[Для агентов](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.ru.md)** и **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — весь API на одной странице, под контекст ИИ-ассистента: дайте ссылку Claude, Cursor или Copilot.
- **Примеры** — три рабочих демо на одной мультитенантной модели: [react-spa](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/react-spa), [next-app](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/next-app) и [drizzle-pg](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/drizzle-pg), где `can()` и скомпилированный `WHERE` сверяются построчно.

## Лицензия

MIT
