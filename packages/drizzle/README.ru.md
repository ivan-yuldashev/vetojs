# ⚡ @vetojs/drizzle

> Права доступа как SQL: политика превращается в `WHERE`, и запрос возвращает ровно те строки, которые пользователю разрешено видеть.

[![NPM version](https://img.shields.io/npm/v/%40vetojs%2Fdrizzle)](https://www.npmjs.com/package/@vetojs/drizzle)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@vetojs/drizzle?activeTab=dependencies)
[![Postgres](https://img.shields.io/badge/postgres-supported-336791)](https://orm.drizzle.team)
[![License](https://img.shields.io/npm/l/%40vetojs%2Fdrizzle)](https://github.com/ivan-yuldashev/vetojs/blob/main/LICENSE)
[![Socket](https://socket.dev/api/badge/npm/package/@vetojs/drizzle)](https://socket.dev/npm/package/@vetojs/drizzle)

SQL-сторона движка [`@vetojs`](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md) — **[English](README.md) · [Русский](README.ru.md)**.

[`@vetojs`](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md) описывает права как массив правил в обычном JSON и отвечает по ним на вопрос «можно ли *этому* пользователю сделать *это* с *этой* строкой» — метод `ability.can("update", "post", post)`.

Но для списка нужен обратный вопрос: не «можно ли трогать вот эту строку», а «какие строки вообще показывать». Проверять их в JavaScript после выборки поздно — пагинация и `count` уже посчитаны по всей таблице. Этот пакет компилирует тот же массив правил в условие `WHERE` для Drizzle, и лишние строки просто не приезжают.

## Почему @vetojs/drizzle

- **Права пишутся один раз.** Условие для `WHERE` собирается из тех же правил, по которым отвечает `can()`. Отдельного описания доступа для SQL заводить не нужно.
- **Совпадение проверено, а не заявлено.** Сетка на соответствие гоняет оба пути — `can()` по загруженным строкам и настоящий `SELECT` — на живом Postgres, по строкам с `NULL` в каждой колонке, и требует совпадения множеств идентификаторов.
- **Джойны выводятся сами.** Связи собираются по внешним ключам, уже объявленным в вашей схеме. Писать джойн руками приходится только там, где условие сложнее совпадения ключей.
- **0 зависимостей.** `@vetojs/core` и `drizzle-orm` — peer-зависимости.

---

## Quick Start

### 1. Установка

```sh
npm install @vetojs/drizzle @vetojs/core drizzle-orm
# или
pnpm add @vetojs/drizzle @vetojs/core drizzle-orm
```

Только ESM, Node.js 20 и новее. Пока Postgres.

### 2. Свяжите ресурсы с таблицами

Ниже `ac` — то же объявление `defineAbilities`, что и в ядре: ресурсы `post` и `user`, у поста действия `read`, `update`, `publish`. `posts` и `users` — ваши таблицы Drizzle.

```ts
const schema = defineTables(ac, { post: posts, user: users });
//    ^? DrizzleSchema<typeof ac>
```

Карта тотальна: пропущенный ресурс — ошибка компиляции, а не тихо незакрытая таблица. Экран, за которым строк нет вовсе, объявляется `null` — это сказано намеренно, а не забыто.

### 3. Отфильтруйте запрос

```ts
const where = schema.filter(ability, "read", "post");
//    ^? SQL<unknown> — не `SQL | undefined`, подставляется без проверок

const rows = await db.select().from(posts).where(where);
```

Свои условия дописываются после ресурса и сужают выборку вместе с политикой, но не в обход неё:

```ts
await db.select().from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, "p1")));
```

Связи превращаются в подзапросы `EXISTS`, поэтому `author.role` или `comments.some.spam` работают в SQL так же, как в памяти.

Действие и ресурс `filter` берёт из того же объявления, что и `can()`, — списки в подсказках совпадают:

```ts
type Resources = ResourceName<typeof ac>;
//   ^? "post" | "user"

type PostActions = ActionFor<typeof ac, "post">;
//   ^? "read" | "update" | "publish" | "manage"

schema.filter(ability, "publish", "post");
//                      ^| автодополнение предложит только эти четыре
```

`manage` добавляется к каждому ресурсу — это подстановочное действие, покрывающее все остальные. Всё, чего в объявлении нет, не компилируется:

```ts
schema.filter(ability, "archive", "post");
//                      ^^^^^^^^^ ✗ Argument of type '"archive"' is not assignable to parameter of type 'ActionFor<…, "post">'
```

## Чем отличается от фильтрации в коде

Альтернатива адаптеру — выбрать строки из базы и отсеять лишние в JavaScript. Вот что при этом меняется:

| Задача | Отфильтровать в JavaScript | `schema.filter` |
|---|---|---|
| Что приезжает из базы | все строки ресурса | только разрешённые |
| Пагинация и `count` | считаются до фильтра — цифры врут | считает Postgres |
| Строка с `NULL` в колонке | как напишете | `coalesce(…, false)` — вердикт всегда двузначный |
| `UPDATE` и `DELETE` | «прочитать, потом проверить», между ними окно | тот же предикат в `WHERE`, окна нет |
| Совпадение с `can()` | на вашей совести | сверяется тестом на живом Postgres |

У CASL похожую задачу решает `accessibleBy`, но ему нужен адаптер под конкретную ORM. Для Prisma и Mongoose такие адаптеры есть, а для SQL и Sequelize [запрос открыт с 2017 года](https://github.com/stalniy/casl/issues/8) — то есть на Drizzle этот путь просто недоступен, и правила пришлось бы переписывать в `WHERE` руками, второй раз и без сверки с `can()`.

## Тот же предикат на записи

`WHERE` уместен и в `UPDATE`, и в `DELETE`:

```ts
const [updated] = await db.update(posts).set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();
```

Скрытая политикой строка не совпадёт — запрос не тронет ничего, а пустой результат и есть ваш 404: без похода «сначала прочитать, потом проверить» и без окна между ними, в котором строка успевает измениться.

## Где SQL и JavaScript расходятся

Если переводить условие в SQL один в один, гарантия ломается — из-за `NULL`. `NOT (amount > 1000)` при `amount = NULL` даёт в SQL `UNKNOWN`, и `WHERE` выбрасывает строку, — тогда как движок считает отсутствующее значение разрешимым несовпадением и строку допускает. Запрос с фильтром-запретом спрятал бы строку, на которую у пользователя есть право.

Поэтому каждый листовой предикат компилируется в нечто всегда истинное или ложное — `IS DISTINCT FROM`, `COALESCE(…, FALSE)` и тому подобное, — а значение неподходящего типа решается на месте, а не отдаётся Postgres, который привёл бы `'5000' > 1000` к числам и показал строку, запрещённую движком.

Когда у правила нет честного двузначного перевода — неизвестный адаптеру оператор, квантор помимо `some` / `every` / `none`, отсутствующая колонка — он бросает исключение при сборке запроса. SQL не выполняется, утечь нечему.

## Одна таблица без карты ресурсов

Если карта не нужна, дерево условий компилируется напрямую:

```ts
const condition = toDrizzle(ability.where("read", "post"), posts);
//    ^? SQL<unknown>
```

Связи так не разворачиваются — `toDrizzle` работает по одной таблице.

## Contributing

Нужен другой диалект, не хватает оператора, не выводится джойн — [расскажите об этом в issue](https://github.com/ivan-yuldashev/vetojs/issues/new). Пожелания к API читаются наравне с баг-репортами и влияют на то, что делается следующим.

Порядок работы описан в [CONTRIBUTING.md](https://github.com/ivan-yuldashev/vetojs/blob/main/CONTRIBUTING.md), сообщения об уязвимостях — в [SECURITY.md](https://github.com/ivan-yuldashev/vetojs/blob/main/SECURITY.md).

## Что дальше

- **[Полное руководство](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/drizzle.ru.md)** — вывод джойнов, ресурсы без таблиц, таблица перевода по каждому оператору и ограничения.
- **[О проекте](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md)** — что такое `@vetojs` и как устроен сам движок.
- **[Для агентов](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.ru.md)** и **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — весь API на одной странице, под контекст ИИ-ассистента: дайте ссылку Claude, Cursor или Copilot.
- **Пример** — [drizzle-pg](https://github.com/ivan-yuldashev/vetojs/tree/main/examples/drizzle-pg): `can()` и скомпилированный `WHERE` сверяются построчно.

## Лицензия

MIT
