import { describe, expect, expectTypeOf, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import {
	type ActionFor,
	createRules,
	defineAbilities,
	type ResourceName,
	type ShapeOf,
	shape,
} from "../../src/create/index.js";

type Post = { id: string; authorId: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
		report: { actions: ["view", "export"] },
	},
});

type AC = typeof ac;

const { allow, deny } = createRules(ac);

describe("a resource declared without a schema", () => {
	it("is a resource like any other", () => {
		expectTypeOf<ResourceName<AC>>().toEqualTypeOf<"post" | "report">();
		expectTypeOf<ActionFor<AC, "report">>().toEqualTypeOf<
			"view" | "export" | "manage"
		>();
		expect(Object.keys(ac)).toEqual(["post", "report"]);
	});

	it("has an empty shape, and the neighbour keeps its own", () => {
		expectTypeOf<ShapeOf<AC, "report">>().toEqualTypeOf<
			Record<string, never>
		>();
		expectTypeOf<ShapeOf<AC, "post">>().toEqualTypeOf<Post>();
	});

	it("answers the row-less check from the rules", () => {
		const ability = buildAbility(ac, [allow("view", "report")]);

		expect(ability.can("view", "report")).toBe(true);
		expect(ability.can("export", "report")).toBe(false);
		expect(ability.cannot("export", "report")).toBe(true);
	});

	it("obeys a blanket deny", () => {
		const ability = buildAbility(ac, [
			allow("manage", "report"),
			deny("export", "report"),
		]);

		expect(ability.can("view", "report")).toBe(true);
		expect(ability.can("export", "report")).toBe(false);
	});

	it("takes no row and no field condition", () => {
		const ability = buildAbility(ac, [allow("view", "report")]);

		// @ts-expect-error a resource with no rows has no row to pass
		ability.can("view", "report", { id: "r1" });

		// @ts-expect-error and no field to write a condition against
		allow("view", "report", { where: { id: "r1" } });

		expect(ability.can("view", "report")).toBe(true);
	});

	it("validates like a phantom schema — objects pass, anything else fails", () => {
		const ability = buildAbility(ac, []);

		expect(ability.validate("report", {})).toEqual({ ok: true, value: {} });
		expect(ability.validate("report", { anything: 1 })).toEqual({
			ok: true,
			value: { anything: 1 },
		});
		expect(ability.validate("report", "nope")).toEqual({
			ok: false,
			issues: [{ message: "expected an object" }],
		});
		expect(ability.validate("report", null)).toEqual({
			ok: false,
			issues: [{ message: "expected an object" }],
		});
	});

	it("takes no schema planted on the prototype", () => {
		const planted = {
			"~standard": {
				version: 1,
				vendor: "planted",
				validate: () => ({ value: { role: "admin" } }),
			},
		};

		(Object.prototype as Record<string, unknown>).schema = planted;

		try {
			expect(buildAbility(ac, []).validate("report", "nope")).toEqual({
				ok: false,
				issues: [{ message: "expected an object" }],
			});
		} finally {
			delete (Object.prototype as Record<string, unknown>).schema;
		}
	});

	it("is still told apart from a resource nobody declared", () => {
		const ability = buildAbility(ac, []);

		expect(ability.validate("report", {})).toEqual({ ok: true, value: {} });
		expect(
			// @ts-expect-error the whole point: an undeclared resource fails closed
			ability.validate("nowhere", {}),
		).toEqual({
			ok: false,
			issues: [{ message: 'unknown resource "nowhere"' }],
		});
	});

	it("keeps evaluating structurally when a row is forced past the types", () => {
		const ability = buildAbility(ac, [allow("view", "report")]);

		expect(
			// @ts-expect-error a row smuggled in by a cast must not widen the answer
			ability.can("view", "report", { secret: true }),
		).toBe(true);

		const guarded = buildAbility(ac, [
			allow("view", "report"),
			deny("view", "report", {
				// @ts-expect-error a rule from a database, written against a field we never declared
				where: { secret: true },
			}),
		]);

		expect(
			// @ts-expect-error same smuggled row: the deny reads it and wins
			guarded.can("view", "report", { secret: true }),
		).toBe(false);
		expect(
			// @ts-expect-error the field says otherwise, so the deny does not apply
			guarded.can("view", "report", { secret: false }),
		).toBe(true);
	});

	it("leaves the row-carrying neighbour untouched", () => {
		const ability = buildAbility(ac, [
			allow("read", "post", { where: { authorId: "u1" } }),
			allow("view", "report"),
		]);

		expect(ability.can("read", "post", { id: "p1", authorId: "u1" })).toBe(
			true,
		);
		expect(ability.can("read", "post", { id: "p2", authorId: "u2" })).toBe(
			false,
		);
		expect(ability.can("view", "report")).toBe(true);
	});

	it("still filters the neighbour and answers nothing about itself", () => {
		const ability = buildAbility(ac, [
			allow("read", "post", { where: { authorId: "u1" } }),
			allow("view", "report"),
		]);

		expect(ability.where("read", "post")).toEqual({
			field: "authorId",
			op: "eq",
			value: "u1",
		});
		expect(ability.where("view", "report")).toEqual({ and: [] });
	});
});
