# ⚡ @vetojs/next

> No longer maintained. The guard moved to `@vetojs/core/guard`.

[![Deprecated](https://img.shields.io/badge/status-deprecated-red)](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.md)

**[English](README.md) · [Русский](README.ru.md)**

The guard in this package never imported `next` or `react`, so it moved into the engine as **`@vetojs/core/guard`** — where it can also serve HTTP handlers and agent tool calls. This package is now a re-export and will receive no further changes.

## Moving over

Change the import. Nothing else: the API is identical, and the package it lives in is one you already depend on.

```ts
import { createGuard } from "@vetojs/core/guard";
```

Then drop `@vetojs/next` from your dependencies. `@vetojs/core` must be `0.7.0` or newer.

## Where the docs went

- **[The guard](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/guard.md)** — everything this README used to describe, plus HTTP handlers and tool calls.
- **[Express, Fastify, Hono](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/http.md)** — the guard outside Next.
- **[Agents](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/agents.md)** — guarding what a model may call.
- **[About the project](https://github.com/ivan-yuldashev/vetojs#readme)** — the general concept behind `@vetojs`.
- **[For agents](https://github.com/ivan-yuldashev/vetojs/blob/main/docs/for-agents.md)** and **[llms.txt](https://github.com/ivan-yuldashev/vetojs/blob/main/llms.txt)** — the whole API on one page, sized to fit an AI assistant's context: hand the link to Claude, Cursor or Copilot.

## License

MIT
