# Запись — строки, поля и значения

**[English](mutations.md) · [Русский](mutations.ru.md)**

Запись задаёт два вопроса: можно ли пользователю трогать строку и можно ли ему записать эти данные.

```ts
if (!ability.canMutate("update", "post", row)) {
	throw new ForbiddenError("update", "post");
}

const result = ability.validatePayload("update", "post", row, data);

if (!result.ok) {
	return badRequest(result.violations); // [{ field, reason }]
}

await db.update(posts).set(result.data).where(eq(posts.id, row.id));
```

Пишите `result.data` — проверенную копию. [Гвард](./guard.ru.md) выполняет оба шага до вашего обработчика.

## `canMutate` — строка

То же решение, что `can` со строкой. Без строки — при создании — пропускает, только если действие покрывает `allow` без `where` и ни один `deny` не смотрит в строку.

## `validatePayload` — данные

```ts
ability.validatePayload(action, resource, row, data);
// → { ok: true, data } | { ok: false, violations: [{ field, reason }] }
```

Строку он принимает потому, что от неё зависит, какие правила действуют: правило про черновики не ограничивает запись в опубликованный пост. Строку, которую не покрывает ни один `allow`, он отвергает даже с пустыми данными. При создании вместо строки передают `undefined`; правила по полям и значениям по-прежнему отвечают, а `allow` с условием на строку ничего не разрешает.

Проверяются только ключи, которые есть в `data`, поэтому PATCH присылает лишь то, что меняет. Молча ничего не вырезается — о каждом отвергнутом ключе сообщается:

| `reason` | когда |
|---|---|
| `field not permitted` | поле не называет ни один подошедший `allow` или его называет `deny` |
| `value not permitted` | у поля есть ограничения значений в `allow`, и значение не подходит ни под одно |
| `value denied` | значение подходит под ограничение в `deny` |

```ts
allow("update", { post: ["title", "status"] }, {
	where: { authorId: actor.id },
	values: { status: { in: ["draft"] } },
});

// { title: "New title" }  → ok
// { status: "draft" }     → ok
// { status: "published" } → status: value not permitted
// { featured: true }      → featured: field not permitted
```

Пустой список `violations` — тоже отказ: запись отклонили целиком — `deny` без полей и значений или потому, что не нашлось `allow`.

## Ответ агенту

Модель, которая видит отвергнутое поле, исправляет аргумент, а не повторяет вызов. Верните нарушения результатом инструмента:

```ts
const result = ability.validatePayload("update", "post", row, data);

if (!result.ok) {
	return {
		isError: true,
		content: [{ type: "text", text: result.violations.map((v) => `${v.field}: ${v.reason}`).join("; ") }],
	};
}
```

Как встроить это в вызов инструмента, описано в разделе [как охранять то, что делает агент](./agents.ru.md).

## Почему так устроено

- **Одно нарушение на поле** — первая, самая точная причина.
- **`deny` без `fields` и `values` отклоняет запись целиком**, поэтому отправка одних разрешённых полей его не обойдёт.
- **`deny` с `fields` или `values` говорит о данных, а не о строках.** Он убирает поля или значения из разрешённого и не трогает `can` и `canMutate`; если читать его как правило о строке, «никогда это поле» означало бы «никогда это действие».
- **В `deny` `fields` и `values` не сочетаются.** Поле из `fields` убирается при любом значении; запрещённое значение пишут одним `values`.

## Исходники

[`api/mutation.ts`](../packages/core/src/api/mutation.ts) · [тесты](../packages/core/tests/api/mutation.test.ts)
