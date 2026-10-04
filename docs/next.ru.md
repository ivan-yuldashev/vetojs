# `@vetojs/next` — больше не развивается

**[English](next.md) · [Русский](next.ru.md)**

Гвард переехал в движок — теперь это [`@vetojs/core/guard`](./guard.ru.md). `@vetojs/next@0.2.0` остаётся в npm как реэкспорт и новых версий не получит.

Поменяйте импорт и уберите `@vetojs/next` из зависимостей; API тот же. Нужен `@vetojs/core` версии `0.7.0` или новее.

```ts
import { createGuard } from "@vetojs/core/guard";
```
