# `@vetojs/next` — retired

**[English](next.md) · [Русский](next.ru.md)**

The guard moved into the engine as [`@vetojs/core/guard`](./guard.md). `@vetojs/next@0.2.0` stays on npm as a re-export and receives no further versions.

Change the import and drop `@vetojs/next` from your dependencies; the API is the same. `@vetojs/core` must be `0.7.0` or newer.

```ts
import { createGuard } from "@vetojs/core/guard";
```
