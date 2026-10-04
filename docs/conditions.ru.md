# Условия

**[English](conditions.md) · [Русский](conditions.ru.md)**

Условие — обычный объект: ключи — поля, значения — то, с чем сравнивать.

```ts
allow("update", "post", {
	where: {
		status: "draft",                           // равно
		views: { lt: 100 },                        // оператор
		authorId: { in: [actor.id, "u2"] },
		or: [{ pinned: true }, { featured: true }],
		author: { role: "admin" },                 // связь
	},
});
```

Соседние ключи означают **и**; `and`, `or` и `not` группируют явно. Ключ-[связь](./relations.ru.md) переходит в связанную строку.

## Операторы по типу поля

| Поле | Операторы |
|---|---|
| любой скаляр | `eq ne in nin exists` и голое значение вместо `eq` |
| `number`, `Date` | ещё `gt gte lt lte` |
| `string` | ещё `contains` |
| массив скаляров | `has hasAny hasAll exists` |
| объект или массив объектов | `exists` |

Проходят по типам только они, по одному оператору на поле. Как каждый ведёт себя на `null`, чужих типах и `NaN`, описано в разделе [операторы](./operators.ru.md).

У поля-массива спрашивают про элементы — `{ tags: { has: "release" } }`. Голый массив, `{ tags: ["a"] }`, не компилируется: массив целиком ни с чем не сравнивается.

## Сравнение двух полей

`{ ref }` на месте значения сравнивает два поля одной строки — под `eq`, `ne`, `gt`, `gte`, `lt` или `lte`:

```ts
const ac = defineAbilities({
	resources: { invoice: { schema: shape<{ spent: number; limit: number }>(), actions: ["update"] } },
});
const { allow } = createRules(ac);

allow("update", "invoice", { where: { spent: { lte: { ref: "limit" } } } });
// хранится как { field: "spent", op: "lte", ref: "limit" }
```

Типы предлагают только поля подходящего типа; внутри связи оба поля берутся из связанной строки. Если одной из сторон нет, она `null` или `NaN`, ответ — «неизвестно», как SQL отвечает на `spent <= limit` с `NULL` по любую сторону, поэтому `can()` и скомпилированный `WHERE` совпадают. `ref` допустим только в `where`.

## Хранимое дерево

Короткая запись компилируется при создании правила, и хранится вот что:

```ts
type ConditionNode =
	| { field: string; op: string; value: unknown }
	| { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; ref: string }
	| { relation: string; type: "one"; where: ConditionNode }
	| { relation: string; type: "many"; match: "some" | "every" | "none"; where: ConditionNode }
	| { and: ConditionNode[] }
	| { or: ConditionNode[] }
	| { not: ConditionNode };
```

`Date` хранится числом миллисекунд, чтобы правило оставалось JSON, а `Date` из ORM всё равно с ним сравнивается. `ability.where()` обозначает «все строки» как `{ and: [] }`, а «ни одной» — как `{ or: [] }`.

## Да, нет или неизвестно

Условие отвечает «да», «нет» или **«неизвестно»** — когда данные ему не подходят: поле не того типа, испорченная связь. `and` — «нет», если хоть одна часть «нет»; `or` — «да», если хоть одна «да»; в остальных случаях неизвестная часть делает неизвестным всё. `not` оставляет «неизвестно» как есть, поэтому `deny`, обёрнутый в `not`, кривые данные не пропускает. Что решение делает с «неизвестно», описано в разделе [как принимается решение](./rule-evaluation.ru.md#когда-данные-не-подходят).

## Где какая форма допустима

| | поля | `and` | `or` / `not` | связи | `ref` |
|---|---|---|---|---|---|
| `where` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `values` — [запись](./mutations.ru.md) | ✓ | ✓ | — | — | — |
| `when` — [окружение](./define-abilities.ru.md#окружение-запроса) | ✓ | ✓ | ✓ | — | — |

Запрещённое значение — это `deny` с `values`, а не `or` / `not` внутри ограничения.

## Почему так устроено

- **Компиляция при создании.** Движок, SQL-адаптер и база видят одно и то же простое дерево.
- **Голое значение — это `eq`**, потому что так пишут чаще всего.
- **Узел несёт ровно одну форму.** [`parseRules`](./parse.ru.md) отвергает узел, где есть и поле, и `and`: иначе при чтении одна половина потерялась бы.

## Исходники

[`create/where-input.ts`](../packages/core/src/create/where-input.ts) · [`create/condition-shorthand.ts`](../packages/core/src/create/condition-shorthand.ts) · [`model/condition.ts`](../packages/core/src/model/condition.ts) · [тесты](../packages/core/tests/create/where-input.test.ts)
