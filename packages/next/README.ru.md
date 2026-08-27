# ⚡ @vetojs/next

> Больше не поддерживается. Гвард переехал в `@vetojs/core/guard`.

[![Deprecated](https://img.shields.io/badge/status-deprecated-red)](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.ru.md)

**[English](README.md) · [Русский](README.ru.md)**

Гвард из этого пакета никогда не импортировал ни `next`, ни `react`, поэтому переехал в движок как **`@vetojs/core/guard`** — там он ещё может обслуживать HTTP-обработчики и вызовы инструментов агентом. Пакет остаётся реэкспортом и меняться больше не будет.

## Как перейти

Поменяйте импорт. Больше ничего: API тот же, а пакет, в котором он теперь живёт, у вас уже в зависимостях.

```ts
import { createGuard } from "@vetojs/core/guard";
```

После этого уберите `@vetojs/next` из зависимостей. Нужна версия `@vetojs/core` не ниже `0.7.0`.

## Куда переехала документация

- **[Гвард](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.ru.md)** — всё, что описывал этот README, плюс HTTP-обработчики и вызовы инструментов.
- **[Express, Fastify, Hono](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/http.ru.md)** — гвард за пределами Next.
- **[Агенты](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/agents.ru.md)** — как охранять то, что может вызвать модель.
- **[О проекте](https://github.com/ivan-yuldashev/vetojs/blob/main/README.ru.md)** — общая концепция `@vetojs`.
- **[Для агентов](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.ru.md)** и **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — весь API на одной странице, под контекст ИИ-ассистента: дайте ссылку Claude, Cursor или Copilot.

## Лицензия

MIT
