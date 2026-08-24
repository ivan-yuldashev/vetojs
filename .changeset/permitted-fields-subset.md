---
"@vetojs/core": patch
---

**`permittedFields` is typed as a subset of the fields you asked about.**

`ability.permittedFields("update", "post", ["status"])` now has the type `"status"[]` instead of every key of the resource. That is what the call has always returned; only the type was wider.

Feeding the result into something keyed by those fields — a form config, a record of inputs — now type-checks without a cast.
