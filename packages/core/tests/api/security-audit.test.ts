import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/ability.js";
import type { CheckedRules } from "../../src/api/checked-rules.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { parseRules } from "../../src/api/parse.js";
import { shape } from "../../src/api/schema.js";
import { toVocabulary } from "../../src/api/vocabulary.js";
import { evaluateCondition } from "../../src/evaluation/index.js";
import type { Rule } from "../../src/model/index.js";

type Txn = { id: string; amount: number };
type User = { id: string; role: string };
type Doc = { id: string; note: string };
type Tag = { id: string; classified: boolean };

const ac = defineAbilities({
	resources: {
		txn: { schema: shape<Txn>(), actions: ["update"] },
		user: { schema: shape<User>(), actions: ["update"] },
		doc: {
			schema: shape<Doc>(),
			actions: ["read"],
			relations: { tags: { resource: "tag", kind: "many" } },
		},
		tag: { schema: shape<Tag>(), actions: ["read"] },
	},
});
const { allow, deny } = createRules(ac);

describe("security audit", () => {
	it("F1: deny amount>1000 blocks a string amount", () => {
		const ability = buildAbility(ac, [
			allow("update", "txn"),
			deny("update", "txn", { where: { amount: { gt: 1000 } } }),
		]);
		expect(ability.can("update", "txn", { id: "t", amount: 5000 })).toBe(false);
		expect(
			ability.can("update", "txn", {
				id: "t",
				amount: "5000",
			} as unknown as Txn),
		).toBe(false);
	});

	it("F2: deny role eq 'admin' blocks an array-wrapped role", () => {
		const ability = buildAbility(ac, [
			allow("update", "user"),
			deny("update", "user", { where: { role: { eq: "admin" } } }),
		]);
		expect(ability.can("update", "user", { id: "u", role: "admin" })).toBe(
			false,
		);
		expect(
			ability.can("update", "user", {
				id: "u",
				role: ["admin"],
			} as unknown as User),
		).toBe(false);
	});

	it("F3: a null in a relation array does not disable deny", () => {
		const ability = buildAbility(ac, [
			allow("read", "doc"),
			deny("read", "doc", { where: { tags: { some: { classified: true } } } }),
		]);
		expect(
			ability.can("read", "doc", {
				id: "d",
				tags: [{ classified: true }],
			} as unknown as Doc),
		).toBe(false);
		expect(
			ability.can("read", "doc", {
				id: "d",
				tags: [{ classified: true }, null],
			} as unknown as Doc),
		).toBe(false);
	});

	it("F-A: deny note contains 'secret' blocks a non-string note", () => {
		const ability = buildAbility(ac, [
			allow("read", "doc"),
			deny("read", "doc", { where: { note: { contains: "secret" } } }),
		]);
		expect(ability.can("read", "doc", { id: "d", note: "has secret" })).toBe(
			false,
		);
		expect(
			ability.can("read", "doc", {
				id: "d",
				note: ["secret"],
			} as unknown as Doc),
		).toBe(false);
		expect(ability.can("read", "doc", { id: "d", note: "clean" })).toBe(true);
	});

	it("F-D: a malformed nin (non-array) allow rule grants nothing", () => {
		const rules: Rule[] = [
			{
				effect: "allow",
				action: "update",
				resource: "user",
				where: { field: "role", op: "nin", value: "admin" },
			},
		];
		const ability = buildAbility(ac, rules as CheckedRules);
		expect(ability.can("update", "user", { id: "u", role: "guest" })).toBe(
			false,
		);
	});

	it("blanket can() returns true for a conditional allow (optimistic gating)", () => {
		const ability = buildAbility(ac, [
			allow("read", "doc", { where: { tags: { some: { classified: true } } } }),
		]);
		expect(ability.can("read", "doc")).toBe(true);
	});

	it("can/cannot are symmetric and fail-closed on a non-object instance", () => {
		const ability = buildAbility(ac, [allow("update", "txn")]);
		const garbage = "not-an-object" as unknown as Txn;
		expect(ability.can("update", "txn", garbage)).toBe(false);
		expect(ability.cannot("update", "txn", garbage)).toBe(true);
	});

	it("B: where() agrees with can() on a type-confused row (fail-closed filter contract)", () => {
		const ability = buildAbility(ac, [
			allow("read", "doc"),
			deny("read", "doc", { where: { note: { contains: "secret" } } }),
		]);
		const row = { id: "d", note: ["secret"] } as unknown as Doc;

		const decision = ability.can("read", "doc", row);
		const filter = ability.where("read", "doc");
		const visible = evaluateCondition(filter, row) === true;

		expect(decision).toBe(false);
		expect(visible).toBe(false);
		expect(visible).toBe(decision);
	});

	it("F-U: a claim missing at runtime cannot widen a rule to every row", () => {
		const claims = JSON.parse("{}") as { role: string };

		expect(() =>
			allow("update", "user", { where: { role: claims.role } }),
		).toThrow(TypeError);

		const scoped = allow("update", "user", { where: { role: "editor" } });

		expect(
			buildAbility(ac, [scoped]).can("update", "user", {
				id: "u",
				role: "admin",
			}),
		).toBe(false);
	});

	it("F-N: NaN does not let both halves of an ordered deny step aside", () => {
		const row: Txn = { id: "t", amount: Number.NaN };

		const over = buildAbility(ac, [
			allow("update", "txn"),
			deny("update", "txn", { where: { amount: { gt: 1000 } } }),
		]);

		const under = buildAbility(ac, [
			allow("update", "txn"),
			deny("update", "txn", { where: { amount: { lte: 1000 } } }),
		]);

		expect([
			over.can("update", "txn", row),
			under.can("update", "txn", row),
		]).not.toEqual([true, true]);
	});

	it("F-P: parseRules answers with a result for a resource named after a prototype member", () => {
		const result = parseRules(
			[{ effect: "allow", action: "update", resource: "constructor" }],
			toVocabulary(ac),
		);

		expect(result.ok && result.unknown).toHaveLength(1);
	});

	it("F-P: validate rejects a resource named after a prototype member", () => {
		expect(
			buildAbility(ac, []).validate("constructor" as never, { id: "u" }).ok,
		).toBe(false);
	});

	it("F-E: a non-boolean exists value is refused or unknown, never coerced", () => {
		const parsed = parseRules(
			[
				{
					effect: "allow",
					action: "update",
					resource: "user",
					where: { field: "role", op: "exists", value: "false" },
				},
			],
			toVocabulary(ac),
		);

		const granted =
			parsed.ok &&
			buildAbility(ac, parsed.rules).can("update", "user", {
				id: "u",
				role: "admin",
			});

		expect(granted).toBe(false);
	});

	it("F-C: a deny whose payload names nothing stays a blanket veto", () => {
		const row: User = { id: "u", role: "admin" };

		const empty = buildAbility(ac, [
			allow("update", "user"),
			deny("update", "user", { payload: {} }),
		]);

		const vacuous = buildAbility(ac, [
			allow("update", "user"),
			deny("update", "user", { payload: { constraints: {} } }),
		]);

		expect(vacuous.can("update", "user", row)).toBe(
			empty.can("update", "user", row),
		);
	});

	it("C: an ordered deny does not fire on an absent value (decidable non-match)", () => {
		const ability = buildAbility(ac, [
			allow("update", "txn"),
			deny("update", "txn", { where: { amount: { gt: 1000 } } }),
		]);
		expect(
			ability.can("update", "txn", { id: "t", amount: null } as unknown as Txn),
		).toBe(true);
		expect(ability.can("update", "txn", { id: "t" } as unknown as Txn)).toBe(
			true,
		);
		expect(
			ability.can("update", "txn", {
				id: "t",
				amount: "5000",
			} as unknown as Txn),
		).toBe(false);
	});
});

describe("open findings — an it.fails turns red once the finding is fixed", () => {
	it.fails("a polluted Object.prototype.and leaves conditions decidable", () => {
		const scoped = allow("update", "user", { where: { role: "admin" } });
		let granted: boolean;

		(Object.prototype as Record<string, unknown>).and = [];
		try {
			granted = buildAbility(ac, [scoped]).can("update", "user", {
				id: "u",
				role: "guest",
			});
		} finally {
			delete (Object.prototype as Record<string, unknown>).and;
		}

		expect(granted).toBe(false);
	});

	it.fails("the rules an ability exposes are a snapshot of the policy", () => {
		const policy = [allow("update", "txn")];
		const ability = buildAbility(ac, policy);

		policy.push(deny("update", "txn"));

		expect(ability.rules).toHaveLength(1);
	});

	it.fails("a validated payload does not carry __proto__ through as a field", () => {
		const ability = buildAbility(ac, [allow("update", "user")]);
		const data = JSON.parse('{"role":"admin","__proto__":{"isAdmin":true}}');

		const result = ability.validatePayload(
			"update",
			"user",
			{ id: "u", role: "guest" },
			data,
		);

		expect(result.ok && Object.hasOwn(result.data, "__proto__")).toBe(false);
	});
});
