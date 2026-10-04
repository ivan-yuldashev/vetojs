# Rules from outside — `parseRules`

**[English](parse.md) · [Русский](parse.ru.md)**

Rules being plain JSON is what makes them easy to store and ship. It is also what makes them dangerous when they come back: JSON from a database, an admin UI, or the network is untrusted input. `parseRules` is the door it has to pass through.

```ts
import { buildAbility, parseRules } from "@vetojs/core";

const result = parseRules(JSON.parse(raw));

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
- `action` is an action name or a non-empty list of them; `resource` is a resource name — an empty name or list is refused, since it matches nothing;
- `where`, if present, is a well-formed condition — known operators, each carrying a value it can compare (a real array for `in`, `nin`, `hasAny` and `hasAll`, a boolean for `exists`, a string for `contains`, a number or a string for `gt`, `gte`, `lt` and `lte`), groups naming at least one condition, relations with a valid `one`/`many` shape;
- every condition node carries **exactly one** shape: a node naming both `and` and `field` is refused, in a `where` and in `values` alike;
- `fields`, if present, is a non-empty list of non-empty field names, and `values` is flat; a `payload` key is refused, since a rule carries `fields` and `values` itself.

## Names this deployment doesn't know

Shape checking cannot catch a rule that is perfectly well-formed but mentions something that doesn't exist here — `resource: "psot"`, or an action from a newer version of your schema during a rolling deploy.

**Names are not checked against anything, deliberately.** Where rules are written, the compiler answers the question: `createRules(ac)` refuses an action your declarations don't carry, and it does so before the code runs. Where rules arrive from outside, the answer is code generation from the same source that produced them — a check reports the drift after it happened, generation stops it from happening.

What that leaves you responsible for: rules and the build reading them come from the same generation. The failure modes are not equally loud, and it is worth knowing which is which.

| A rule naming something this build lacks | What a check does |
|---|---|
| an unknown resource or action | matches nothing — an `allow` grants nothing, a `deny` protects nothing |
| an unknown relation | throws `RelationNotLoadedError` when a check reaches it: the row cannot carry what the build never declared, and a missing relation is a data error, not a refusal |

Field names are deliberately **not** checked either: a Standard Schema doesn't enumerate its keys, and the engine handles an absent field as a decidable non-match anyway.

## You can't forget the gate

`buildAbility` doesn't accept a raw `Rule[]`. It accepts rules that provably went through a check, which happens in exactly two places:

1. `createRules(ac)` — the compiler verified them;
2. `parseRules(input)` — this gate verified them.

```ts
const rules: Rule[] = load();

buildAbility(ac, rules);                             // ✗ not checked
buildAbility(ac, parseRules(JSON.parse(raw)).rules); // ✓
```

One gap worth knowing: `JSON.parse` returns `any`, and `any` defeats every type. `buildAbility(ac, JSON.parse(raw))` therefore *does* compile. The marker catches the mistakes a type can catch — a hand-written literal, a plain `Rule[]` — not a value that has thrown its type away. Route untrusted JSON through the gate because it is untrusted, not because the compiler will stop you.

The marker is type-level only — rules stay plain JSON with no extra properties — and it deliberately does not survive `JSON.parse`. Deserialised rules must pass the gate again, which is the entire point.

## Why it works this way

- **A result object, never an exception.** Bad data is an expected condition here, not an exceptional one.
- **All errors at once, with paths.** A UI editor or a migration script wants the full list, not a fail-fast.
- **Every name is looked up as an own property**, so a crafted `op`, `resource`, `field` or `relation` called `constructor` or `toString` reads nothing through the prototype chain: operators are matched against a value allowlist, and resources and relations are read with `Object.hasOwn` first.
- **No schema library.** Hand-written recursion keeps the engine dependency-free and stops the rule format from being coupled to someone else's validator.

## Source

[`validate/parse.ts`](../packages/core/src/validate/parse.ts) · tests: [parse](../packages/core/tests/validate/parse.test.ts)
