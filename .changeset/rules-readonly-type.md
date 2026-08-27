---
"@vetojs/core": minor
"@vetojs/react": patch
---

**`ability.rules` is typed as the read-only list it already is.**

The array has been frozen since it became the snapshot the checks read, but its type still said `CheckedRule[]`, so `ability.rules.push(rule)` compiled and only failed when it ran. It is now `readonly CheckedRule[]`, and the mistake is a type error.

Everything that takes a policy accepts a read-only one: `buildAbility`, `AbilityProvider`, `useSetRules` and the guard. Rebuilding from a snapshot — `buildAbility(ac, other.rules)` — reads the same as before. `CheckedRules` itself is unchanged, so a rule list you build and mutate on the way to `buildAbility` still compiles.
