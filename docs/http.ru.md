# Express, Fastify, Hono и всё, у чего есть обработчик

**[English](http.md) · [Русский](http.ru.md)**

Пакета `@vetojs/express` нет и не будет. HTTP-обработчик — это функция, а гвард оборачивает функции. Между фреймворками различается только то, где на запросе лежит пользователь и как превратить отказ в статус, — по нескольку строк, а не по пакету.

## Собрать ability один раз за запрос

Как бы это ни называлось во фреймворке, middleware делает одно и то же:

```ts
const abilityFor = async (actorId: string) => {
	const currentActor = { id: actorId };

	return buildAbility(ac, policyFor(currentActor));
};
```

Положите результат на запрос — и он будет у всех обработчиков ниже. Сборка дешёвая: несколько замыканий над обычными данными, ни кэша, ни общего состояния между пользователями.

У каждого фреймворка есть свой способ сказать «в этом слоте лежит ability», и его стоит применить: обработчики получат типизированный объект, а не `unknown`.

```ts
type AppBindings = {
	Variables: {
		ability: Ability<typeof ac>;
		user: { id: string };
	};
};

const authorization = createMiddleware<AppBindings>(async (c, next) => {
	c.set("ability", buildAbility(ac, policyFor(c.get("user"))));

	await next();
});
```

В Express слот объявляют расширением запроса — `declare global { namespace Express { interface Request { ability: Ability<typeof ac> } } }`, во Fastify — расширением `FastifyRequest` в блоке `declare module "fastify"`. Те же три строки, тот же результат.

## Охранять запись

```ts
const update = withPermission(
	{
		action: "update",
		resource: "post",
		load: (id: string, _body: Partial<Post>) => loadPost(id),
		payload: (_id: string, body: Partial<Post>) => body,
	},
	async (ctx) => ctx.payload,
);

const respond = async (id: string, body: Partial<Post>) => {
	try {
		return { status: 200, body: await update(id, body) };
	} catch (error) {
		if (ForbiddenError.is(error)) {
			return { status: 403, body: { violations: error.violations } };
		}

		throw error;
	}
};
```

`ctx.payload` — проверенная копия, писать надо её, а не исходное тело. Список `violations` называет поле и причину, и это именно то, что нужно клиенту API, чтобы починить запрос.

## Фильтровать чтение

Список — это запрос, а не проверка. Спрашивайте у базы то, что пользователю видно:

```ts
const rows = await db
	.select()
	.from(posts)
	.where(schema.filter(ability, "read", "post"));
```

Забрать всё и отфильтровать в обработчике работает до второй страницы: счётчик врёт, пагинация врёт, а строки всё равно уехали по сети. См. [фильтрацию в базе](./where.ru.md).

## Достать одну строку

Самая частая форма в CRUD-API — «эта строка по id, если политика разрешает». Передавайте свой предикат адаптеру, а не склеивайте снаружи:

```ts
const row = await db
	.select()
	.from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, "p1")));
```

Если вернулось пусто — отвечайте 404, а не 403: сообщить анонимному вызывающему, что строка существует, но запрещена, уже само по себе разглашение.

## Запись через тот же фильтр

Предикат — это `WHERE`, значит его место и в `UPDATE`, и в `DELETE`:

```ts
const [updated] = await db
	.update(posts)
	.set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();

if (updated === undefined) {
	notFound();
}
```

Строка, скрытая политикой, не совпадёт — запрос не тронет ничего, и вы отвечаете тем же 404, что и для несуществующей строки: без похода «сначала прочитать, потом проверить» и без окна между ними, в котором строка успевает измениться. `payload` у гварда отвечает на вопрос *какие поля этому пользователю можно писать*, а это — на вопрос *какие строки ему можно писать вообще*.

## Что на самом деле добавляет каждый фреймворк

| | Откуда берётся пользователь | Как отказ становится ответом |
|---|---|---|
| Express | `req.user` из вашего session-middleware | обработчик ошибок, переводящий `ForbiddenError` в 403 |
| Fastify | `request.user` или декоратор | `setErrorHandler` |
| Hono | `c.get("user")` из вашего auth-middleware | `app.onError` |
| FeathersJS | `context.params.user` | хук ошибок |

Эта таблица и есть вся специфика фреймворков — поэтому здесь страница, а не четыре пакета.

## Почему так устроено

- **Гвард не читает запрос.** Он принимает ваши `load` и `payload` и те аргументы, которые вам и так передали, поэтому подстраивать под фреймворк в нём нечего.
- **Ability живёт на запрос, а не на приложение.** Он замкнут на правила одного пользователя; разделить его между пользователями — та самая ошибка, которую эта форма делает трудной.
- **Отказ — исключение, а не возвращаемое значение.** Обработчик, забывший проверку, не отработает молча: `authorize` и гвард бросают, а ваш обработчик ошибок отвечает 403 в одном месте.

## Исходники

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [гвард в целом](./guard.ru.md) · [фильтрация в базе](./where.ru.md)
