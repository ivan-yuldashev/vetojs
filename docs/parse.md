# Rules from outside — `parseRules`

**[English](parse.md) · [Русский](parse.ru.md)**

Rules stored in a database, edited in an admin UI or produced by a model are untrusted input. `parseRules` checks their shape before `buildAbility` will take them:

```ts
import { buildAbility, parseRules } from "@vetojs/core";

const result = parseRules(JSON.parse(raw));

if (!result.ok) {
	throw new Error(result.errors.join("\n"));
}

const ability = buildAbility(ac, result.rules);
```

It returns every problem with its path instead of throwing:

```
rules[1].where.or[0].op: unknown operator "regex"
rules[2].effect: expected "allow" | "deny"
```

The other direction needs no API: `JSON.stringify(ability.rules)`.

## What gets checked

- an array of rule objects, `effect` exactly `"allow"` or `"deny"`;
- `action` a non-empty name or list of names, `resource` a non-empty name;
- conditions are well-formed: known operators, each with a value it can compare — an array for `in`, `nin`, `hasAny`, `hasAll`, a boolean for `exists`, a string for `contains`, a number or a string for `gt`, `gte`, `lt`, `lte`; `ref` only in `where` and only under `eq ne gt gte lt lte`; groups that name at least one condition; relations with a valid shape; exactly one shape per node;
- `fields` a non-empty list of non-empty names, `values` flat, `when` without relations;
- no `payload` key — rules written for an older build carried one.

Every key is read as an own property, so a polluted `Object.prototype` adds nothing to a rule.

## Names are not checked

`parseRules` does not know your declarations. A well-formed rule naming something this build lacks passes:

| The rule names | On a check |
|---|---|
| an unknown resource or action | matches nothing — an `allow` grants nothing, a `deny` protects nothing |
| an unknown relation | throws `RelationNotLoadedError` when reached |

Generate stored rules from the same declarations the reading build uses: `createRules(ac)` refuses unknown names at compile time. See [emitting rules as JSON](./for-agents.md#emitting-rules-as-json).

## The gate is hard to skip

`buildAbility` takes only rules from `createRules` or `parseRules`:

```ts
import { buildAbility, type Rule } from "@vetojs/core";

declare const stored: Rule[];
buildAbility(ac, stored); // ✗ not checked
```

`buildAbility(ac, JSON.parse(raw))` does compile, because `any` defeats every type. Route untrusted JSON through the gate because it is untrusted, not because the compiler will stop you. A rule that went through `JSON.parse` has to pass the gate again.

## Why it works this way

- **A result, not an exception.** Bad stored data is expected, and an editor or a migration wants every error at once.
- **Only an exact `"allow"` grants.** `"Allow"` or a typo is refused here, and the engine would not read it as a grant either.
- **No schema library.** Hand-written checks keep the engine free of dependencies.

## Source

[`validate/parse.ts`](../packages/core/src/validate/parse.ts) · [tests](../packages/core/tests/validate/parse.test.ts)
