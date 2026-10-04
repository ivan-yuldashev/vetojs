import { describe, expect, it, vi } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { ForbiddenError } from "../../src/errors/index.js";

type Post = { id: string; authorId: string; status: string; title: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["create", "read", "update"] },
	},
});

const { allow, deny } = createRules(ac);

const mine: Post = { id: "p1", authorId: "me", status: "open", title: "t" };

const refuses = (run: () => void): boolean => {
	try {
		run();
		return false;
	} catch (error) {
		if (ForbiddenError.is(error)) {
			return true;
		}

		throw error;
	}
};

describe("a question with no row that the rules cannot settle", () => {
	const unsettled = [
		{
			name: "a permission that reads the row",
			rules: [allow("update", "post", { where: { authorId: "me" } })],
		},
		{
			name: "a prohibition that reads the row",
			rules: [
				allow("update", "post"),
				deny("update", "post", { where: { status: "closed" } }),
			],
		},
		{
			name: "both",
			rules: [
				allow("update", "post", { where: { authorId: "me" } }),
				deny("update", "post", { where: { status: "closed" } }),
			],
		},
	];

	for (const { name, rules } of unsettled) {
		it(`is refused by authorize and canMutate, with ${name}`, () => {
			const ability = buildAbility(ac, rules);

			expect(refuses(() => ability.authorize("update", "post"))).toBe(true);
			expect(ability.canMutate("update", "post")).toBe(false);
		});

		it(`stays open for can, with ${name}`, () => {
			const ability = buildAbility(ac, rules);

			expect(ability.can("update", "post")).toBe(true);
			expect(ability.cannot("update", "post")).toBe(false);
		});

		it(`refuses the payload of a write, with ${name}`, () => {
			const ability = buildAbility(ac, rules);

			expect(
				ability.validatePayload("update", "post", undefined, { title: "x" }),
			).toEqual({ ok: false, violations: [] });
		});

		it(`is answered by the row once there is one, with ${name}`, () => {
			const ability = buildAbility(ac, rules);

			expect(refuses(() => ability.authorize("update", "post", mine))).toBe(
				false,
			);
			expect(ability.canMutate("update", "post", mine)).toBe(true);
		});
	}
});

describe("a question with no row that the rules settle", () => {
	const settled = [
		{ name: "a blanket permission", rules: [allow("create", "post")] },
		{
			name: "a permission that names fields",
			rules: [allow("create", { post: ["title"] })],
		},
		{
			name: "a permission that names values",
			rules: [allow("create", "post", { values: { status: "open" } })],
		},
		{
			name: "a blanket permission beside a conditional one",
			rules: [
				allow("create", "post", { where: { authorId: "me" } }),
				allow("create", "post"),
			],
		},
		{
			name: "a prohibition on fields, even one that reads the row",
			rules: [
				allow("create", "post"),
				deny("create", { post: ["authorId"] }, { where: { status: "open" } }),
			],
		},
	];

	for (const { name, rules } of settled) {
		it(`is granted by authorize and canMutate, with ${name}`, () => {
			const ability = buildAbility(ac, rules);

			expect(refuses(() => ability.authorize("create", "post"))).toBe(false);
			expect(ability.canMutate("create", "post")).toBe(true);
		});
	}

	it("is refused by a blanket prohibition, which the report names", () => {
		const onDecision = vi.fn();
		const blanket = deny("create", "post");
		const ability = buildAbility(ac, [allow("create", "post"), blanket], {
			onDecision,
		});

		expect(refuses(() => ability.authorize("create", "post"))).toBe(true);
		expect(onDecision).toHaveBeenCalledWith({
			action: "create",
			resource: "post",
			allowed: false,
			rule: blanket,
		});
	});

	it("reports the permission that granted it", () => {
		const onDecision = vi.fn();
		const blanket = allow("create", "post");
		const ability = buildAbility(
			ac,
			[allow("create", "post", { where: { authorId: "me" } }), blanket],
			{ onDecision },
		);

		ability.authorize("create", "post");

		expect(onDecision).toHaveBeenCalledWith({
			action: "create",
			resource: "post",
			allowed: true,
			rule: blanket,
		});
	});
});

describe("a payload with no row to judge the rows by", () => {
	it("is not judged against an empty row, where a negation holds", () => {
		const ability = buildAbility(ac, [
			allow("update", "post", { where: { status: { ne: "archived" } } }),
		]);

		expect(
			ability.validatePayload("update", "post", undefined, { title: "x" }),
		).toEqual({ ok: false, violations: [] });
	});

	it("still answers field by field under a permission no row can change", () => {
		const ability = buildAbility(ac, [
			allow("create", { post: ["title"] }),
			deny("create", "post", { values: { status: "archived" } }),
		]);

		expect(
			ability.validatePayload("create", "post", undefined, {
				title: "x",
				authorId: "me",
			}),
		).toEqual({
			ok: false,
			violations: [{ field: "authorId", reason: "field not permitted" }],
		});
		expect(
			ability.validatePayload("create", "post", undefined, { title: "x" }),
		).toEqual({ ok: true, data: { title: "x" } });
	});
});

describe("the fields a form may offer", () => {
	const ability = buildAbility(ac, [
		allow("update", { post: ["title"] }, { where: { status: "open" } }),
		allow("update", { post: ["status"] }),
		deny("update", { post: ["status"] }, { where: { authorId: "them" } }),
	]);

	const theirs: Post = { ...mine, authorId: "them" };
	const closed: Post = { ...mine, status: "closed" };

	it("are exact with the row", () => {
		expect(
			ability.permittedFields("update", "post", mine, ["title", "status"]),
		).toEqual(["title", "status"]);
		expect(
			ability.permittedFields("update", "post", closed, ["title", "status"]),
		).toEqual(["status"]);
		expect(
			ability.permittedFields("update", "post", theirs, ["title", "status"]),
		).toEqual(["title"]);
	});

	it("are optimistic without it", () => {
		expect(
			ability.permittedFields("update", "post", undefined, ["title", "status"]),
		).toEqual(["title", "status"]);
	});

	it("agree with the payload check on the same row", () => {
		for (const row of [mine, closed, theirs]) {
			for (const field of ["title", "status"] as const) {
				const offered = ability
					.permittedFields("update", "post", row, [field])
					.includes(field);

				expect(
					ability.validatePayload("update", "post", row, { [field]: "x" }).ok,
				).toBe(offered);
			}
		}
	});
});
