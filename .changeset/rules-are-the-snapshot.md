---
"@vetojs/core": minor
---

**`ability.rules` is the snapshot the ability answers from, frozen.**

The checks read a copy of the policy taken at build time, but the array handed back was the caller's own. Anything reading `ability.rules` — the guard, when it asks whether a blanket prohibition exists, or a server component serialising the policy for the client — could therefore see rules the checks did not, once that array was appended to.

`ability.rules` is now the same list the checks read, and frozen, so the two cannot drift apart and neither can be changed from outside. Its contents are unchanged: the rule objects are the ones you passed, in order, ready to send to a client.
