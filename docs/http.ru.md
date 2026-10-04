# HTTP-обработчики — Express, Fastify, Hono

**[English](http.md) · [Русский](http.ru.md)**

HTTP-обработчик — это функция, а гвард оборачивает функции, поэтому пакет под фреймворк не нужен. Различается только то, где на запросе лежит пользователь и как отказ превращается в статус.

## Ability на каждый запрос

```ts
type AppBindings = {
	Variables: { ability: Ability<typeof ac>; user: { id: string } };
};

const authorization = createMiddleware<AppBindings>(async (c, next) => {
	c.set("ability", buildAbility(ac, policyFor(c.get("user"))));
	await next();
});
```

Это Hono. В Express слот типизируют расширением `Express.Request`, в Fastify — расширением `FastifyRequest` внутри `declare module "fastify"`.

## Охраняем запись

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

По `violations` клиент API видит, какое поле поправить.

## Одна строка через фильтр

```ts
const [post] = await db.select().from(posts)
	.where(schema.filter(ability, "read", "post", eq(posts.id, "p1")));

const [updated] = await db.update(posts).set(data)
	.where(schema.filter(ability, "update", "post", eq(posts.id, "p1")))
	.returning();
```

Пустой результат значит «нет или не ваше»; отвечайте 404 в обоих случаях, чтобы вызывающий не узнал, что строка существует. На записи тот же предикат не оставляет окна между чтением и проверкой. Какие поля можно писать, решает `payload` гварда; какие строки — фильтр.

## Что добавляет каждый фреймворк

| | Откуда пользователь | Отказ → ответ |
|---|---|---|
| Express | `req.user` из вашего middleware сессии | обработчик ошибок, превращающий `ForbiddenError` в 403 |
| Fastify | `request.user` или декоратор | `setErrorHandler` |
| Hono | `c.get("user")` из вашего middleware авторизации | `app.onError` |

## Почему так устроено

- **Ability — на запрос.** Он замкнут на правила одного пользователя; поделить его между пользователями — именно та ошибка, которую такое устройство затрудняет.
- **Отказы — исключения.** Обработчик, забывший проверку, падает громко, а 403 на все случаи отвечает один обработчик ошибок.

## Исходники

[`guard/guard.ts`](../packages/core/src/guard/guard.ts) · [гвард](./guard.ru.md) · [фильтрация в базе](./where.ru.md)
