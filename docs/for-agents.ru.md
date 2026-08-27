# Для агентов

**[English](for-agents.md) · [Русский](for-agents.ru.md)**

Всё, что нужно, чтобы написать корректный код на Veto, — на одной странице. Если вы генерируете код для чужого проекта, начните отсюда: в последнем разделе собраны ошибки, которые выглядят правдоподобно, но неверны.

## Установка

```sh
npm install @vetojs/core          # движок
npm install @vetojs/react         # по желанию: <Can>, useAbility, AbilityProvider
# гвард лежит внутри @vetojs/core, под @vetojs/core/guard
```

Только ESM, Node 22+. `@vetojs/core` — peer-зависимость обеих привязок, поэтому ставьте его рядом с ними, а не рассчитывайте, что он подтянется сам. Для `@vetojs/react` нужен ещё React 18+ как peer.

## Весь путь целиком

```ts
import { defineAbilities, shape, createRules, buildAbility } from "@vetojs/core";

// 1. Опишите схему ресурсов один раз. Все типы ниже выводятся отсюда.
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

// 2. Политика — чистая функция от пользователя, возвращающая массив правил.
const { allow, deny } = createRules(ac);

const policyFor = (user: { id: string }) => [
	allow("read", "post", { where: { status: "published" } }),
	allow(["update", "publish"], "post", { where: { authorId: user.id } }),
	deny("update", "post", { payload: { fields: ["featured"] } }),
];

// 3. Соберите на запрос — и проверяйте доступ.
const ability = buildAbility(ac, policyFor(currentUser));

ability.can("update", "post", post);
```

## Поверхность API

### `@vetojs/core`

| Экспорт | Сигнатура | Зачем |
|---|---|---|
| `defineAbilities` | `({ resources }) => AC` | объявляет ресурсы, действия и связи. `schema` необязательна: у ресурса без строк — экрана, отчёта — её не пишут, форма получается пустой, и ни строка, ни сравнение по полю не проходят по типам |
| `shape<T>()` | `() => Schema<T>` | несёт форму строки и в рантайме не проверяет ничего. Передайте вместо неё схему Zod / Valibot / ArkType — и `ability.validate` начнёт проверять данные, а форма выведется из схемы. **Не Yup**: его реализация Standard Schema асинхронная, а асинхронная схема бросает исключение |
| `createRules` | `(ac, { maxDepth? }?) => { allow, deny }` | типизированные фабрики правил |
| `buildAbility` | `(ac, rules) => AbilitySet` | превращает политику в объект, который вы вызываете |
| `parseRules` | `(json, vocabulary) => RuleParseResult` | проверяет недоверенный JSON с правилами |
| `toVocabulary` | `(ac) => Vocabulary` | сериализуемые имена, если словарь хранится отдельно |
| `markLoaded` | `(row, relation, value) => row` | сообщает, что связь загружена |
| `"manage"` | имя действия | wildcard: `allow("manage", "post")` даёт все действия, объявленные у `post`, **включая те, что появятся позже**. Когда нужен снимок, перечислите явно — `allow([...ac.post.actions], "post")` |
| `ConditionOperator` | объект-константа | `eq ne in nin gt gte lt lte contains exists has hasAny hasAll` |
| `ForbiddenError` | класс | `.action`, `.resource`, `.violations?`; опознавать через `ForbiddenError.is(error)`, а не `instanceof` |
| `RelationNotLoadedError` | класс | `.relation` |
| `type<T>()` | `() => Schema<T>` | **устарело**, прежнее имя `shape`, та же функция. Написанный код продолжает работать; в новом пишите `shape` |

Методы `ability`:

| Метод | Возвращает | Для чего |
|---|---|---|
| `can(action, resource, row?)` | `boolean` | ветвление. **Без строки ответ оптимистичный** — истина, когда есть покрывающий `allow` и нет глухого `deny`, — и это ровно то, что нужно решению о рендере, пока строки ещё нет |
| `cannot(action, resource, row?)` | `boolean` | ранний выход |
| `authorize(action, resource, row?)` | `void`, бросает `ForbiddenError` | границы на сервере |
| `canMutate(action, resource, row)` | `boolean` | можно ли писать в эту строку |
| `validatePayload(action, resource, row, data)` | `{ ok: true, data } \| { ok: false, violations }` | можно ли записать эти данные |
| `permittedFields(action, resource, fields)` | подмножество `fields` | для формы |
| `where(action, resource)` | `ConditionNode` | фильтр для базы |
| `validate(resource, data)` | `{ ok: true, value } \| { ok: false, issues }` | проверка по схеме; каждая проблема — `{ message, path? }`, где `path` — поле, на которое указала схема |
| `rules` | `CheckedRules` | отправить клиенту |

### `@vetojs/react`

**В серверном компоненте берите серверную точку входа — ни провайдера, ни контекста, в браузер не уезжает ничего:**

```tsx
import { Can } from "@vetojs/react/server";

const ability = await getAbility();

<Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
	<EditForm post={post} />
</Can>
```

Для клиентских компонентов вызовите фабрику один раз:

```ts
// src/veto.ts — вызовите фабрику один раз, импортируйте привязки отсюда
import { createVetoContext } from "@vetojs/react";
export const { AbilityProvider, useAbility, useCan, useSetRules, Can } =
	createVetoContext(ac);
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
| `Can` из `@vetojs/react/server` | закрыть серверный компонент; принимает `ability` напрямую |
| `<Can>` из фабрики | закрыть клиентский компонент |
| `useCan(action, resource, row?)` | один вердикт; перерисовка только когда меняется этот ответ |
| `useAbility()` | всё сверх «да/нет» — `permittedFields`, `validate`, фильтрация списка |
| `useSetRules()` | смена пользователя на клиенте без перерисовки страницы |

### `@vetojs/core/guard`

`createGuard({ ac, getActor, policy })` возвращает `withPermission(options, handler)`. Фреймворков он не знает — та же обёртка охраняет server action, HTTP-обработчик и вызов инструмента агентом. Опишите `load` для строки и `payload` для записываемых данных; обработчик выполнится, только если пройдут обе проверки. В `ctx.payload` окажется проверенная копия, а `ctx.row` при объявленном `load` — строка, а не «может быть строка». См. [руководство](./guard.ru.md).

Ресурс — существительное словаря, а не таблица, поэтому эффект, которому нечего загружать — письмо, запись файла, вебхук, списание с карты, — охраняется так же: `load` собирает строку из аргументов, выводя поля, по которым судит политика (`recipientDomain`, а не сырой адрес). Пропустить `load` здесь — ошибка: ответ без строки оптимистичен, а условный `deny` откажет всем вызовам. См. [охрану действий агента](./agents.ru.md).

## Как писать условия

Соседние ключи объединяются через И. Голое значение означает «равно».

```ts
where: {
	status: "published",                  // eq
	views: { gte: 100 },                  // объект с оператором
	title: { contains: "release" },       // только для строк
	authorId: { in: ["u1", "u2"] },
	deletedAt: { exists: false },
	tags: { has: "release" },             // поле-массив: has | hasAny | hasAll
	author: { role: "admin" },            // связь «к одному»
	comments: { none: { spam: true } },   // «ко многим»: some | every | none
	or: [{ pinned: true }, { views: { gt: 1000 } }],
}
```

Операторы предлагаются по типу поля, остальное система типов отклоняет:

| Поле | Операторы |
|---|---|
| любой скаляр | `eq ne in nin exists`, плюс голое значение как `eq` |
| `number`, `Date` | ещё `gt gte lt lte` |
| `string` | ещё `contains` |
| массив скаляров | `has` (один элемент), `hasAny`, `hasAll`, `exists` — **не** `eq` и не `in` |
| объект или массив объектов | только `exists` |

Запомнить стоит две последние строки: поле-массив принимает `has` / `hasAny` / `hasAll`, а всё нескалярное можно проверить только на наличие — сравнение по значению всегда даёт «неизвестно».

## Проверка записи

Два вопроса, которые держат раздельно:

```ts
if (!ability.canMutate("update", "post", row)) throw new ForbiddenError("update", "post");

const result = ability.validatePayload("update", "post", row, data);
if (!result.ok) return badRequest(result.violations); // [{ field, reason }]

await db.update(posts).set(result.data).where(eq(posts.id, row.id));
```

Пишите `result.data`, а не исходный ввод: это проверенная копия.

## Фильтрация в базе

```ts
const filter = ability.where("read", "post"); // обычное дерево условий
```

Фильтр отбирает ровно те строки, которые разрешил бы `can()`. Передайте его адаптеру базы; без адаптера считайте это данными и не пытайтесь разбирать дерево вручную.

С `@vetojs/drizzle` компиляция и склейка делаются одним вызовом: свои условия идут после ресурса и сужают выборку вместе с политикой:

```ts
db.select().from(posts).where(schema.filter(ability, "read", "post", eq(posts.id, id)));
```

## Правила извне

```ts
const result = parseRules(JSON.parse(raw), ac);
if (!result.ok) throw new Error(result.errors.join("\n"));
const ability = buildAbility(ac, result.rules);
```

`buildAbility` ждёт проверенные правила — от `createRules` либо от `parseRules` **со словарём**. Система типов следит за этим везде, где у значения ещё есть тип (см. оговорку про `any` ниже).

## Как выдавать правила в JSON

Когда вы не вызываете политику, а составляете её — заполняете админку, пишете в базу, — выдавайте хранимую форму и отдавайте её на проверку шлюзу. Контракт, по которому писать, — `toVocabulary(ac)`: одни имена, без схем, несколько сотен байт на обычный домен.

```ts
const proposed = [
	{
		effect: "allow",
		action: ["update", "publish"],
		resource: "post",
		where: { field: "authorId", op: "eq", value: "u1" },
		payload: {
			fields: ["status"],
			constraints: { field: "status", op: "in", value: ["draft"] },
		},
	},
];

const result = parseRules(proposed, toVocabulary(ac));
```

Отказать могут двумя способами, и реагировать на них надо по-разному:

| Результат | Что значит | Что делать |
|---|---|---|
| `ok: false` | форма неверна | исправить и повторить — у каждой ошибки есть путь, вида `rules[0].where.op: unknown operator "regex"` |
| `ok: true` и непустой `unknown` | имя, которого в этой установке не знают | `allow` **отправлен в карантин** и не даёт ничего; `deny` **оставлен**, потому что запрет обязан продолжать защищать |

Если читать только `result.rules`, второй случай не виден: придуманное действие или ресурс превращают `allow` в ничто молча. Смотрите `unknown` и сообщайте о нём.

**У узла ровно одна форма.** Узел условия называет что-то одно: `and`, `or`, `not`, `relation` или поле. Поле и `and` в одном объекте будут отклонены — их никто не объединяет, читатель взял бы одно и потерял другое.

## Чего делать не надо

Всё перечисленное выглядит правдоподобно и при этом неверно.

**Голый массив у поля-массива.** Он сравнивается с этим массивом, а сравнение с массивом или объектом всегда даёт **«неизвестно»**: оно ничего не разрешает и заставляет сработать любой `deny`. Типы это отклоняют — берите оператор вхождения.

```ts
where: { tags: ["a", "b"] }             // ✗ типы отклонят
where: { tags: { in: ["a", "b"] } }     // ✗ `in` — для скалярных полей, не для массивов
where: { tags: { has: "release" } }     // ✓ этот элемент есть
where: { tags: { hasAny: ["a", "b"] } } // ✓ хотя бы один из них
where: { tags: { hasAll: ["a", "b"] } } // ✓ все сразу
```

**Передавать сырой JSON в `buildAbility`.** Всегда идите через `parseRules(json, ac)`.

```ts
buildAbility(ac, JSON.parse(raw));                       // ✗ скомпилируется, но без проверки
buildAbility(ac, parseRules(JSON.parse(raw), ac).rules); // ✓
```

Обратите внимание на комментарий: этот вызов **скомпилируется**, потому что `JSON.parse` возвращает `any`. Типы отклонят литерал или обычный `Rule[]`, но значение, потерявшее свой тип, поймать нечем. Полагаться здесь на компилятор нельзя.

**Использовать проверку без строки как защиту строки.** `can("update", "post")` и `authorize("update", "post")` отвечают на вопрос *возможно ли это хоть для какой-то строки*. Это для решений об отрисовке, а не для защиты операции над конкретной строкой. Если строка есть — передайте её.

**Забыть загрузить связь, которая нужна правилу.** Если правило читает `post.author.role`, автор должен лежать на объекте, иначе `can()` бросит `RelationNotLoadedError`. Загружайте в запросе:

```ts
const post = await db.query.posts.findFirst({ with: { author: true } });
```

Для объектов, собранных руками, есть `markLoaded(post, "author", author)`; для «загружено и пусто» передавайте `null`. Передача `undefined` бросает исключение — именно это и означает «не загружено».

**Считать скрытую кнопку защитой.** `<Can>` и `permittedFields` решают, что отрисовать. Запрос, который они прячут, всё равно можно отправить руками, поэтому на сервере нужна своя проверка каждый раз.

**Ждать, что `deny` отступит на плохих данных.** Запрет срабатывает и на «неизвестно»: значение неверного типа мимо него не проскользнёт. Битые данные способны только сузить доступ, но не расширить.

**Искать настройку, чтобы поменять приоритет.** Запрет всегда сильнее, а всё неразрешённое запрещено; ни то ни другое не настраивается. Именно это позволяет тем же правилам компилироваться в SQL.

**Ловить отказ через `instanceof`.** Пишите `ForbiddenError.is(error)`. Две копии `@vetojs/core` в дереве зависимостей дают ошибке две идентичности класса, и тогда `instanceof` отвечает `false` на совершенно законный отказ, тихо превращая 403 в 500.

```ts
catch (error) {
	if (error instanceof ForbiddenError) { … }  // ✗ ломается на второй копии
	if (ForbiddenError.is(error)) { … }         // ✓ сверяется по зарегистрированному символу
}
```

## Куда что класть

| Место | Что использовать |
|---|---|
| Серверный компонент, route handler | `buildAbility` на запрос, затем `can` / `authorize` |
| Получение списка | `ability.where(...)` в запросе; не фильтруйте в JS постфактум |
| Обработчик мутации | `canMutate` + `validatePayload` |
| Клиентский компонент | `<AbilityProvider rules={ability.rules}>`, `<Can>` / `useAbility` |
| Граница сервер → клиент | отправляйте `ability.rules`, это обычный JSON |

## Полная документация

Страницы по каждому понятию, на английском и русском, собраны в [docs/README.ru.md](./README.ru.md).
