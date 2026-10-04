# Как проверять доступ — `buildAbility`

**[English](ability.md) · [Русский](ability.ru.md)**

`buildAbility(ac, rules)` превращает политику в объект, у которого спрашивают. Собирайте его на каждый запрос.

```ts
const ability = buildAbility(ac, policyFor(user));

ability.can("update", "post", post);       // можно ли этому пользователю править эту строку?
ability.authorize("update", "post", post); // то же, но с ForbiddenError
```

| Метод | Отвечает на вопрос |
|---|---|
| `can(action, resource, row?)`, `cannot` | можно ли действие |
| `authorize(action, resource, row?)` | то же, но на отказ бросает `ForbiddenError` |
| `canMutate(action, resource, row)` | можно ли писать в эту строку — [запись](./mutations.ru.md) |
| `validatePayload(action, resource, row, data)` | можно ли записать эти данные — [запись](./mutations.ru.md) |
| `permittedFields(action, resource, row, fields)` | какие из `fields` можно писать |
| `where(action, resource)` | условие для запроса — [фильтрация](./where.ru.md) |
| `validate(resource, data)` | подходят ли данные под схему ресурса |
| `rules` | правила обычным JSON — для клиента |

## Со строкой или без

Со строкой ответ точный. Без неё `can` оптимистичен — *может ли это быть разрешено для какой-нибудь строки?* — и именно это решает, рисовать ли кнопку «Новый пост». Ответ «да», если действие покрывает какой-нибудь `allow` и его не перекрывает безусловный `deny`.

`authorize`, `canMutate` и вызов через гвард не гадают. Без строки они пропускают, только если действие покрывает `allow` без `where` и ни один `deny` не смотрит в строку:

```ts
// allow("create", "post"), allow("update", "post", { where: { authorId: user.id } })
ability.can("update", "post");             // true — для какого-нибудь поста
ability.authorize("create", "post");       // проходит
ability.authorize("update", "post");       // исключение — какой пост?
ability.authorize("update", "post", post); // точный ответ
```

Если операция касается строки, передайте её.

## Как поймать отказ

```ts
try {
	ability.authorize("delete", "post", post);
} catch (error) {
	if (ForbiddenError.is(error)) {
		error.action;     // "delete"
		error.resource;   // "post"
		error.violations; // есть, если отказали в payload
	}
}
```

Пишите `ForbiddenError.is`, а не `instanceof`: при двух копиях `@vetojs/core` в дереве `instanceof` ответит `false`, и 403 превратится в 500.

## Журнал решений

`onDecision` получает каждый ответ данными — что спросили, что ответили и какое правило решило:

```ts
const ability = buildAbility(ac, policyFor(currentUser), {
	onDecision: (decision) => log.info({ actor: currentUser.id, ...decision }),
});
```

- Срабатывает по разу на вызов `can`, `cannot`, `authorize`, `canMutate` и `validatePayload`; для `where`, `permittedFields` и `validate` — нет.
- `rule` — сработавший `deny` или разрешивший `allow`. Его нет, когда не подошло ничего — о таком вопросе политика молчит, и это повод для алерта, — и когда вызов без строки отказал, потому что ответ от строки зависел.
- Решение по payload несёт не `rule`, а `violations`. `{ field: "authorId", reason: "field not permitted" }` в журнале агента — попытка записать чужое поле.
- `reason: "not a plain row"` помечает строку, которую движок читать не станет: экземпляр класса, `Date`, массив.
- Ни строки, ни данных в отчёте нет; если нужны — замкните их в хуке.
- Хук, бросивший исключение, останавливает вызов, и ваше исключение уходит вызывающему вместо ответа. Ловите внутри хука, если журнал не должен мешать проверке.

## `withEnv` — окружение запроса

Если [объявлено `env`](./define-abilities.ru.md#окружение-запроса), `buildAbility` возвращает `AbilityForEnv`, и по типам у него нечего спросить, пока `withEnv` не подставит окружение одного запроса:

```ts
import { buildAbility, createRules, defineAbilities, shape, withEnv } from "@vetojs/core";

const ac = defineAbilities({
	env: shape<{ hour: number; mfa: boolean }>(),
	resources: { invoice: { schema: shape<{ id: string }>(), actions: ["read", "delete"] } },
});
const { allow, deny } = createRules(ac);

const policy = [
	allow("read", "invoice", { when: { hour: { gte: 9 } } }),
	allow("delete", "invoice"),
	deny("delete", "invoice", { when: { mfa: { ne: true } } }),
];

const ability = withEnv(buildAbility(ac, policy), { hour: 14, mfa: false });
ability.can("read", "invoice");   // true
ability.can("delete", "invoice"); // false — MFA нет, запрет действует
```

Подставляйте окружение один раз на запрос: `can` и `where` на одной привязке читают одно и то же окружение. Повторная привязка к тем же ключам и значениям вернёт тот же ability, так что литерал, записанный на каждом рендере, ничего не пересобирает. `withEnv` импортируется отдельно, поэтому в бандл приложения без окружения он не попадает.

## `permittedFields` — для форм

```ts
ability.permittedFields("update", "post", post, ["title", "status", "views"]);
// → ["title", "status"]
```

Список полей-кандидатов передаёте вы: у схемы нельзя спросить её ключи. Со строкой ответ совпадает с тем, что `validatePayload` скажет по каждому полю. С `undefined` он оптимистичен, как у `can`: поле, которое решила бы только строка, остаётся в списке, а `validatePayload` откажет в нём, когда строка станет известна.

## `validate` — про форму данных, а не про права

```ts
const result = ability.validate("post", input);
if (!result.ok) return badRequest(result.issues); // [{ message, path? }]
```

Запускает [Standard Schema](./define-abilities.ru.md#проверка-данных-настоящей-схемой) ресурса. С `shape<T>()` отвергает только не-объекты. Необъявленный ресурс получает отказ.

## Почему так устроено

- **Ability на запрос почти ничего не стоит.** Это замыкания над правилами одного пользователя — кешировать и делить между пользователями нечего.
- **Проверки тотальны.** Строка, которая не простой объект, получает отказ, поле не того типа даёт «неизвестно», поэтому кривой ввод сужает доступ и никогда не роняет проверку и не разрешает лишнего.
- **Правило про то, чего вы не объявляли, ничему не соответствует.** Прийти такое может только через [`parseRules`](./parse.ru.md#имена-не-проверяются), а он проверяет форму, а не имена.

## Исходники

[`api/ability.ts`](../packages/core/src/api/ability.ts) · [`api/with-env.ts`](../packages/core/src/api/with-env.ts) · [тесты](../packages/core/tests/api/ability.test.ts)
