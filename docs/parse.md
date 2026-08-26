# Rules from outside — `parseRules`

**[English](parse.md) · [Русский](parse.ru.md)**

Rules being plain JSON is what makes them easy to store and ship. It is also what makes them dangerous when they come back: JSON from a database, an admin UI, or the network is untrusted input. `parseRules` is the door it has to pass through.

```ts
import { buildAbility, parseRules } from "@vetojs/core";

const result = parseRules(JSON.parse(raw), ac);

if (!result.ok) {
	throw new Error(`Invalid rules:\n${result.errors.join("\n")}`);
}

const ability = buildAbility(ac, result.rules);
```

It returns a result rather than throwing — you decide whether that's a crash, a log line, or a fallback policy.

Going the other way needs no API at all: `JSON.stringify(ability.rules)`.

## Why this is a security control, not a formality

The engine treats any effect that isn't `deny` as an allow. So a single corrupted `effect` in stored JSON — one character — silently turns a prohibition into a grant. The same goes for an unrecognised operator, or an `in` whose list is not a list.

Checking shape at the door removes that entire class of problem.

## What gets checked

Recursively, collecting **every** problem rather than stopping at the first, with a path for each one:

```
rules[1].where.or[0].op: unknown operator "regex"
rules[2].effect: expected "allow" | "deny"
```

- the top level is an array of objects;
- `effect` is exactly `allow` or `deny`;
- `action` is a string or array of strings; `resource` is a string;
- `where`, if present, is a well-formed condition — known operators, `in`/`nin` carrying real arrays, relations with a valid `one`/`many` shape;
- every condition node carries **exactly one** shape: a node naming both `and` and `field` is refused, in a `where` and in `payload.constraints` alike;
- `payload`, if present, has string `fields` and flat `constraints`.

## Names this deployment doesn't know

Shape checking can't catch a rule that is perfectly well-formed but mentions something that doesn't exist here — `resource: "psot"`, or an action from a newer version of your schema during a rolling deploy.

These two cases are not symmetrical:

- an unknown **allow** grants nothing — harmless in itself;
- an unknown **deny** is a *protection that silently isn't there* — the dangerous one.

So when you pass your declarations as the vocabulary, the gate treats them differently:

| Rule mentioning something unknown | What happens | Why |
|---|---|---|
| `allow` | **quarantined** — reported, not applied | it may not grant access to something this deployment doesn't have |
| `deny` | **kept** and reported | it must keep protecting; removing it could only widen access |

```ts
const result = parseRules(json, ac);

if (!result.ok) throw new Error(result.errors.join(", "));

result.unknown; // [{ rule, reasons, quarantined }]
```

**`parseRules(json, ac)` and `parseRules(json, toVocabulary(ac))` are interchangeable.** The gate reads only the action names and the relations, and a resource declaration is a vocabulary entry with a schema attached, so passing either answers the same. Prefer `toVocabulary(ac)` when the vocabulary is stored: it is the serialisable half, without the schemas, and it is what you keep in a database beside the rules.

What you do with `unknown` is your policy, one line either way:

```ts
expect(result.unknown).toEqual([]);          // in CI, a typo should fail the build
if (result.unknown.length) log.warn(...);    // in production, skew is telemetry
```

**The gate can only narrow access.** Dropping allows and keeping denies cannot turn a denied call into an allowed one — so a deploy where the database is ahead of the code is safe by construction. This is property-tested, not just asserted.

Field names are deliberately **not** checked: a Standard Schema doesn't enumerate its keys, and the engine handles an absent field as a decidable non-match anyway.

## You can't forget the gate

`buildAbility` doesn't accept a raw `Rule[]`. It accepts rules that provably went through a check, which happens in exactly two places:

1. `createRules(ac)` — the compiler verified them;
2. `parseRules(input, vocabulary)` — this gate verified them.

```ts
const rules: Rule[] = load();

buildAbility(ac, rules);                                 // ✗ not checked
buildAbility(ac, parseRules(JSON.parse(raw), ac).rules); // ✓
```

One gap worth knowing: `JSON.parse` returns `any`, and `any` defeats every type. `buildAbility(ac, JSON.parse(raw))` therefore *does* compile. The marker catches the mistakes a type can catch — a hand-written literal, a plain `Rule[]` — not a value that has thrown its type away. Route untrusted JSON through the gate because it is untrusted, not because the compiler will stop you.

The marker is type-level only — rules stay plain JSON with no extra properties — and it deliberately does not survive `JSON.parse`. Deserialised rules must pass the gate again, which is the entire point.

Calling `parseRules` *without* a vocabulary checks shape only and returns unbranded rules, so it won't satisfy `buildAbility` on its own. The escape hatch, when you really mean it (constructing intentionally broken rules in a test), is a visible `as CheckedRules` cast.

## Why it works this way

- **A result object, never an exception.** Bad data is an expected condition here, not an exceptional one.
- **All errors at once, with paths.** A UI editor or a migration script wants the full list, not a fail-fast.
- **Every name is looked up as an own property**, so a crafted `op`, `resource`, `field` or `relation` called `constructor` or `toString` reads nothing through the prototype chain: operators are matched against a value allowlist, and resources and relations are read with `Object.hasOwn` first.
- **No schema library.** Hand-written recursion keeps the engine dependency-free and stops the rule format from being coupled to someone else's validator.

## Source

[`api/parse.ts`](../packages/core/src/api/parse.ts) · tests: [parse](../packages/core/tests/api/parse.test.ts), [vocabulary](../packages/core/tests/api/vocabulary.test.ts)
