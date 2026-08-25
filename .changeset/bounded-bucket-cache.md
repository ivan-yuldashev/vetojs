---
"@vetojs/core": patch
---

**What an ability remembers is bounded by what `defineAbilities` declared.**

An ability groups rules per resource and action the first time it is asked about that pair, and kept every pair it was ever asked about. A long-lived ability — a module singleton, a cached policy, an `AbilityProvider` — behind an endpoint that takes the action or the resource from the request therefore grew without limit: 200k unseen actions retained 41 MB, 200k unseen resources 76 MB.

Only pairs the registry declares are remembered now. A name it does not declare is still answered exactly as before — rules that name it are evaluated, a `deny` among them still overrides — the answer is simply computed each time instead of being kept. Checks on declared pairs are unchanged, including the ones with no matching rules.
