# `@vetojs/drizzle` — политика как SQL

**[English](drizzle.md) · [Русский](drizzle.ru.md)**

Адаптер компилирует политику в `WHERE` для Drizzle, и запрос возвращает ровно те строки, что разрешает `can()`.

```sh
npm install @vetojs/drizzle @vetojs/core drizzle-orm
```

```ts
import { defineTables } from "@vetojs/drizzle";

const schema = defineTables(ac, { post: posts, user: users, comment: comments });

const rows = await db.select().from(posts).where(schema.filter(ability, "read", "post"));
```

## Карта таблиц

`defineTables(ac, tables, joins?)` сопоставляет каждому ресурсу его таблицу, и пропущенный ресурс не компилируется. Ресурс без таблицы — экран, письмо — объявляется как `null`; фильтр по нему или переход к нему через связь бросает исключение.

Джойны выводятся из внешних ключей, если две таблицы связывает ровно один ключ: у дочерней таблицы для «один ко многим», у родительской — для «один к одному». В остальных случаях, или когда ключом условие не выразить, джойн пишут сами:

```ts
const schema = defineTables(ac, tables, {
	post: {
		comments: (post, comment) => sql`${comment.postId} = ${post.id} and not ${comment.deleted}`,
	},
});
```

Джойн — это колбэк, потому что каждому уровню вложенности нужен свой алиас; благодаря этому компилируются связи таблицы с самой собой и глубокие пути.

## `filter`

```ts
schema.filter(ability, "read", "post");                   // из ability
schema.filter("post", ability.where("read", "post"));     // из условия
schema.filter(ability, "read", "post", eq(posts.id, id)); // с вашим предикатом
```

Ваши предикаты только сужают выборку: строка, скрытая политикой, остаётся скрытой. Результат — `SQL`, а не `SQL | undefined`. Тот же предикат нужен на `UPDATE` и `DELETE`:

```ts
const [updated] = await db.update(posts).set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, id)))
	.returning();
```

Скрытая строка не совпадёт, и запрос ничего не тронет: пустой результат — это ваш 404, без окна между чтением и проверкой.

Для одной таблицы без карты дерево компилируется напрямую: `toDrizzle(ability.where("read", "post"), posts)`; для связей нужна карта.

## Связи

| Правило | SQL |
|---|---|
| один к одному, `some` | `EXISTS (… WHERE join AND condition)` |
| `every` | `NOT EXISTS (… WHERE join AND NOT condition)` |
| `none` | `NOT EXISTS (… WHERE join AND condition)` |

## Почему перевод не дословный

`NOT (amount > 1000)` при `amount = NULL` в SQL даёт `UNKNOWN`, и `WHERE` выбрасывает строку, а движок считает `null` однозначным «нет» и строку пропускает. Поэтому каждый лист компилируется в предикат, который истинен или ложен везде, где движок решает, и равен `NULL` только там, где движок отвечает «неизвестно», — так `NOT` вокруг `deny` не пускает такую строку:

| Правило | SQL |
|---|---|
| `eq` / `ne` | `IS [NOT] NULL` для значения null, `=` / `<>` на колонке `NOT NULL`, иначе `IS [NOT] DISTINCT FROM` |
| `gt gte lt lte`, `contains` | обёрнуты в `COALESCE(…, FALSE)`; сравнение по порядку со строкой — «неизвестно»; `contains` — это `strpos(…) > 0`, так что `%` и `_` — обычные символы |
| `in` / `nin` | `COALESCE(col IN (…), FALSE)` и его отрицание; пустой список — `FALSE` |
| `exists` | `IS [NOT] NULL` |
| `has hasAny hasAll` | `@>` / `&&` по колонке-массиву, `FALSE` для `NULL` |
| `ref` | сравнение двух колонок; `NULL` или `NaN` с любой стороны, как и сравнение по порядку двух текстовых колонок, — «неизвестно», как в движке |

Значение, тип которого не совпадает с колонкой, получает тот же ответ, что и в движке, — «неизвестно», — а не уходит в Postgres, который бы его привёл. Правило из JSON, которое не подходит к своей колонке, — `has` на текстовой колонке, слово для числовой, — отвергается ещё при сборке запроса или получает тот же ответ; ошибкой Postgres оно не заканчивается. Правило без честного перевода — незнакомый оператор или квантификатор, несуществующая колонка, связь без карты — бросает исключение ещё при сборке запроса, так что SQL не выполняется.

## Почему так устроено

- **Проверено, а не заявлено.** Тесты на соответствие гоняют `can()` и настоящий `SELECT` на Postgres (PGlite) по строкам с `NULL` в каждой колонке и требуют одинаковых множеств id. `can()` читает строки в том виде, в каком их вернул драйвер.
- **Значения передаются через энкодер колонки**, как у собственных операторов Drizzle, поэтому `bigint`, временные метки и `customType` сериализуются одинаково.
- **Пока только Postgres.**

## Исходники

[`compile.ts`](../packages/drizzle/src/compile.ts) · [`schema.ts`](../packages/drizzle/src/schema.ts) · [`foreign-key-join.ts`](../packages/drizzle/src/foreign-key-join.ts) · тесты: [операторы](../packages/drizzle/tests/to-drizzle.test.ts), [связи](../packages/drizzle/tests/relations.test.ts), [ref](../packages/drizzle/tests/ref.test.ts)
