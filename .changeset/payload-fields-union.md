---
"@vetojs/core": minor
---

**`validatePayload` reads two `allow` rules the way `permittedFields` already did.**

An `allow` that lists `payload.fields` narrowed what a second, unrestricted `allow` had opened, so a form built from `permittedFields` offered a field the write then refused. Allow rules are additive — one unrestricted `allow` opens every field, and taking a field away is `deny`'s job. Both now answer the same question the same way.

If a policy stacked a field-listed `allow` on top of an unrestricted one expecting the list to narrow, those fields now write — move the restriction into a `deny`.
