import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import {
	createRules,
	defineAbilities,
	type StandardSchema,
	shape,
} from "../../src/create/index.js";
import type { CheckedRules } from "../../src/model/index.js";
import { parseRules } from "../../src/validate/index.js";

type Doc = { id: string; status: string; views: number; publishedAt: Date };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const docSchema: StandardSchema<Doc> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value) => {
			if (!isRecord(value)) {
				return { issues: [{ message: "expected an object" }] };
			}

			const parsed: Record<string, unknown> = { ...value };

			if ("views" in value) {
				const views =
					typeof value.views === "string" ? Number(value.views) : value.views;

				if (typeof views !== "number" || Number.isNaN(views)) {
					return {
						issues: [{ message: "views is a number", path: ["views"] }],
					};
				}

				parsed.views = views;
			}

			if ("publishedAt" in value) {
				const at =
					typeof value.publishedAt === "string"
						? new Date(value.publishedAt)
						: value.publishedAt;

				if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
					return {
						issues: [
							{ message: "publishedAt is a date", path: ["publishedAt"] },
						],
					};
				}

				parsed.publishedAt = at;
			}

			return { value: parsed as Doc };
		},
	},
};

const ac = defineAbilities({
	resources: {
		doc: { schema: docSchema, actions: ["update"] },
		page: { schema: shape<Doc>(), actions: ["update"] },
		note: { actions: ["update"] },
	},
});

const { allow, deny } = createRules(ac);

const doc: Doc = {
	id: "d1",
	status: "draft",
	views: 1,
	publishedAt: new Date(0),
};

const fromOutside = (json: unknown): CheckedRules => {
	const parsed = parseRules(json);

	if (!parsed.ok) {
		throw new Error(parsed.errors.join("\n"));
	}

	return parsed.rules;
};

describe("a resource declared with a Standard Schema", () => {
	it("types its values by the schema's output", () => {
		const written = () => [
			allow("update", "doc", {
				values: { views: { lte: 100 }, publishedAt: { lte: new Date(0) } },
			}),
			// @ts-expect-error a number holds no substring
			allow("update", "doc", { values: { views: { contains: "1" } } }),
			// @ts-expect-error a string is not ordered in values
			allow("update", "doc", { values: { status: { gt: "a" } } }),
			// @ts-expect-error the schema has no ghost
			deny("update", "doc", { values: { ghost: 1 } }),
		];

		expect(written).toBeTypeOf("function");
	});

	it("lets the schema check the shape and the rules check the right", () => {
		const ability = buildAbility(ac, [
			allow("update", "doc", { values: { views: { lte: 100 } } }),
		]);

		const inRange = ability.validate("doc", { views: "50" });
		const outOfRange = ability.validate("doc", { views: "500" });

		expect(inRange).toEqual({ ok: true, value: { views: 50 } });
		expect(outOfRange).toEqual({ ok: true, value: { views: 500 } });
		expect(ability.validate("doc", { views: "abc" })).toEqual({
			ok: false,
			issues: [{ message: "views is a number", path: ["views"] }],
		});
		expect(
			inRange.ok &&
				ability.validatePayload("update", "doc", doc, inRange.value),
		).toEqual({ ok: true, data: { views: 50 } });
		expect(
			outOfRange.ok &&
				ability.validatePayload("update", "doc", doc, outOfRange.value),
		).toEqual({
			ok: false,
			violations: [{ field: "views", reason: "value not permitted" }],
		});
	});

	it("fails closed on a raw value the schema never parsed", () => {
		const granting = buildAbility(ac, [
			allow("update", "doc", { values: { views: { lte: 100 } } }),
		]);
		const denying = buildAbility(ac, [
			allow("update", "doc"),
			deny("update", "doc", { values: { views: { gt: 100 } } }),
		]);
		const raw = { views: "50" } as unknown as Partial<Doc>;

		expect(granting.validatePayload("update", "doc", doc, raw)).toEqual({
			ok: false,
			violations: [{ field: "views", reason: "value not permitted" }],
		});
		expect(denying.validatePayload("update", "doc", doc, raw)).toEqual({
			ok: false,
			violations: [{ field: "views", reason: "value denied" }],
		});
	});

	it("compares a date the schema parsed, and refuses the string it came as", () => {
		const ability = buildAbility(ac, [
			allow("update", "doc", {
				values: { publishedAt: { lte: new Date(1000) } },
			}),
		]);
		const early = ability.validate("doc", {
			publishedAt: "1970-01-01T00:00:00.500Z",
		});
		const late = ability.validate("doc", {
			publishedAt: "1970-01-01T00:00:02.000Z",
		});

		expect(
			early.ok && ability.validatePayload("update", "doc", doc, early.value).ok,
		).toBe(true);
		expect(
			late.ok && ability.validatePayload("update", "doc", doc, late.value).ok,
		).toBe(false);
		expect(
			ability.validatePayload("update", "doc", doc, {
				publishedAt: "1970-01-01T00:00:00.500Z",
			} as unknown as Partial<Doc>),
		).toEqual({
			ok: false,
			violations: [{ field: "publishedAt", reason: "value not permitted" }],
		});
	});

	it("does not compile a raw body where the parsed shape belongs", () => {
		const ability = buildAbility(ac, [allow("update", "doc")]);
		const asked = () =>
			// @ts-expect-error views is a number once the schema has parsed it
			ability.validatePayload("update", "doc", doc, { views: "50" });

		expect(asked).toBeTypeOf("function");
	});
});

describe("a resource declared with shape alone", () => {
	it("still fails closed in the rules when validate lets any object through", () => {
		const granting = buildAbility(ac, [
			allow("update", "page", { values: { views: { lte: 100 } } }),
		]);
		const denying = buildAbility(ac, [
			allow("update", "page"),
			deny("update", "page", { values: { views: { gt: 100 } } }),
		]);
		const wrong = { views: "abc" } as unknown as Partial<Doc>;

		expect(granting.validate("page", wrong)).toEqual({
			ok: true,
			value: wrong,
		});
		expect(granting.validate("page", "abc").ok).toBe(false);
		expect(granting.validatePayload("update", "page", doc, wrong)).toEqual({
			ok: false,
			violations: [{ field: "views", reason: "value not permitted" }],
		});
		expect(denying.validatePayload("update", "page", doc, wrong)).toEqual({
			ok: false,
			violations: [{ field: "views", reason: "value denied" }],
		});
	});
});

describe("a resource declared without a schema", () => {
	it("takes no value constraint in the types", () => {
		const written = () =>
			// @ts-expect-error a resource without a schema has no fields to constrain
			allow("update", "note", { values: { text: "x" } });

		expect(written).toBeTypeOf("function");
	});

	it("still applies a value constraint that arrives from outside", () => {
		const ability = buildAbility(
			ac,
			fromOutside([
				{ effect: "allow", action: "update", resource: "note" },
				{
					effect: "deny",
					action: "update",
					resource: "note",
					values: { field: "text", op: "eq", value: "secret" },
				},
			]),
		);
		const secret = { text: "secret" } as unknown as Record<string, never>;
		const plain = { text: "plain" } as unknown as Record<string, never>;

		expect(
			ability.validatePayload("update", "note", undefined, secret),
		).toEqual({
			ok: false,
			violations: [{ field: "text", reason: "value denied" }],
		});
		expect(ability.validatePayload("update", "note", undefined, plain).ok).toBe(
			true,
		);
		expect(ability.validate("note", { text: 1 }).ok).toBe(true);
		expect(ability.validate("note", "text").ok).toBe(false);
	});
});
