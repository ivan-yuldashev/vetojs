import type { RawRuleFrom } from "@casl/ability";
import { createMongoAbility, subject } from "@casl/ability";
import { bench, describe } from "vitest";
import {
	buildAbility,
	createRules,
	defineAbilities,
	markLoaded,
	shape,
} from "../../dist/index.js";

type Row = {
	tenant: string;
	blocked: boolean;
	f0: string;
	f1: string;
	f2: string;
	f3: string;
	f4: string;
};

type Owner = { id: string; role: string };

const rows = {
	schema: shape<Row>(),
	actions: ["read", "update"],
	relations: { owner: { resource: "owner", kind: "one" } },
} as const;

const ac = defineAbilities({
	resources: {
		post: rows,
		comment: rows,
		invoice: rows,
		ticket: rows,
		report: rows,
		file: rows,
		owner: { schema: shape<Owner>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const names = [
	"post",
	"comment",
	"invoice",
	"ticket",
	"report",
	"file",
] as const;

type CaslRule = RawRuleFrom<[string, string], Record<string, unknown>>;

const policy = (perResource: number) => {
	const veto: ReturnType<typeof allow>[] = [];
	const casl: CaslRule[] = [];

	for (const name of names) {
		for (let index = 0; index < perResource; index++) {
			veto.push(
				allow("read", name, {
					where: {
						f0: { in: [`v${index}0`, `w${index}0`] },
						f1: { in: [`v${index}1`, `w${index}1`] },
						f2: { in: [`v${index}2`, `w${index}2`] },
						f3: { in: [`v${index}3`, `w${index}3`] },
						f4: { in: [`v${index}4`, `w${index}4`] },
						tenant: { in: [`t${index}`] },
					},
				}),
			);

			casl.push({
				action: "read",
				subject: name,
				conditions: {
					f0: { $in: [`v${index}0`, `w${index}0`] },
					f1: { $in: [`v${index}1`, `w${index}1`] },
					f2: { $in: [`v${index}2`, `w${index}2`] },
					f3: { $in: [`v${index}3`, `w${index}3`] },
					f4: { $in: [`v${index}4`, `w${index}4`] },
					tenant: { $in: [`t${index}`] },
				},
			});
		}

		veto.push(deny("read", name, { where: { blocked: true } }));
		casl.push({
			action: "read",
			subject: name,
			inverted: true,
			conditions: { blocked: true },
		});
	}

	return { veto, casl };
};

const rowFor = (index: number, matching: boolean): Row => ({
	tenant: `t${index}`,
	blocked: false,
	f0: matching ? `v${index}0` : "miss",
	f1: matching ? `v${index}1` : "miss",
	f2: matching ? `v${index}2` : "miss",
	f3: matching ? `v${index}3` : "miss",
	f4: matching ? `v${index}4` : "miss",
});

const perRole = policy(1);
const perTenant = policy(36);

const cases = [
	{
		what: "grouped by role (12 rules), the row matches",
		rules: perRole,
		resource: "post",
		row: rowFor(0, true),
	},
	{
		what: "grouped by role (12 rules), nothing matches",
		rules: perRole,
		resource: "post",
		row: rowFor(0, false),
	},
	{
		what: "one rule per tenant (222 rules), an early rule matches",
		rules: perTenant,
		resource: "post",
		row: rowFor(0, true),
	},
	{
		what: "one rule per tenant (222 rules), the last rule matches",
		rules: perTenant,
		resource: "file",
		row: rowFor(35, true),
	},
	{
		what: "one rule per tenant (222 rules), nothing matches",
		rules: perTenant,
		resource: "file",
		row: rowFor(35, false),
	},
] as const;

let sink = 0;

for (const { what, rules, resource, row } of cases) {
	const vetoAbility = buildAbility(ac, rules.veto);
	const caslAbility = createMongoAbility(rules.casl);

	if (
		vetoAbility.can("read", resource, row) !==
		caslAbility.can("read", subject(resource, row))
	) {
		throw new Error(`the engines disagree on: ${what}`);
	}

	describe(what, () => {
		bench("veto", () => {
			sink += vetoAbility.can("read", resource, { ...row }) ? 1 : 0;
		});

		bench("casl", () => {
			sink += caslAbility.can("read", subject(resource, { ...row })) ? 1 : 0;
		});
	});
}

describe("a policy with no denies, an early rule matches", () => {
	const veto = perTenant.veto.filter((rule) => rule.effect !== "deny");
	const casl = perTenant.casl.filter((rule) => rule.inverted !== true);

	const vetoAbility = buildAbility(ac, veto);
	const caslAbility = createMongoAbility(casl);
	const row = rowFor(0, true);

	if (
		!vetoAbility.can("read", "post", row) ||
		!caslAbility.can("read", subject("post", row))
	) {
		throw new Error("both engines must grant here");
	}

	bench("veto", () => {
		sink += vetoAbility.can("read", "post", { ...row }) ? 1 : 0;
	});

	bench("casl", () => {
		sink += caslAbility.can("read", subject("post", { ...row })) ? 1 : 0;
	});
});

describe("building an ability from the 222-rule policy", () => {
	bench("veto", () => {
		sink += buildAbility(ac, perTenant.veto).rules.length;
	});

	bench("casl", () => {
		sink += createMongoAbility(perTenant.casl).rules.length;
	});
});

describe("a rule reaching through a relation, the relation loaded", () => {
	const owner: Owner = { id: "o1", role: "admin" };

	const vetoAbility = buildAbility(ac, [
		allow("read", "post", { where: { owner: { role: "admin" } } }),
	]);

	const caslAbility = createMongoAbility([
		{ action: "read", subject: "post", conditions: { "owner.role": "admin" } },
	] satisfies CaslRule[]);

	const plain = rowFor(0, true);
	const vetoRow = markLoaded({ ...plain }, "owner", owner);
	const caslRow = { ...plain, owner };

	if (
		!vetoAbility.can("read", "post", vetoRow) ||
		!caslAbility.can("read", subject("post", caslRow))
	) {
		throw new Error("the relation case must be allowed on both sides");
	}

	bench("veto", () => {
		sink += vetoAbility.can(
			"read",
			"post",
			markLoaded({ ...plain }, "owner", owner),
		)
			? 1
			: 0;
	});

	bench("casl", () => {
		sink += caslAbility.can("read", subject("post", { ...plain, owner }))
			? 1
			: 0;
	});
});

if (sink === Number.MIN_SAFE_INTEGER) {
	throw new Error("unreachable, keeps the work observable");
}
