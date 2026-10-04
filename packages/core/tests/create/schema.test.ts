import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type InferSchema,
	type Schema,
	type StandardSchema,
	shape,
	validateSchema,
} from "../../src/create/index.js";

const mockSchema = (valid: boolean): StandardSchema<{ id: string }> => ({
	"~standard": {
		version: 1,
		vendor: "mock",
		validate: (value) =>
			valid
				? { value: value as { id: string } }
				: { issues: [{ message: "bad" }] },
	},
});

describe("InferSchema", () => {
	it("infers the type from a phantom schema", () => {
		expectTypeOf<InferSchema<Schema<{ a: number }>>>().toEqualTypeOf<{
			a: number;
		}>();
	});

	it("infers the output type from a Standard Schema", () => {
		expectTypeOf<
			InferSchema<StandardSchema<{ id: string; verified: boolean }>>
		>().toEqualTypeOf<{ id: string; verified: boolean }>();
	});
});

describe("validateSchema", () => {
	it("passes through a phantom schema", () => {
		expect(validateSchema(shape<{ id: string }>(), { id: "1" })).toEqual({
			ok: true,
			value: { id: "1" },
		});
	});

	it("fails closed for non-object data on a phantom schema", () => {
		expect(validateSchema(shape<{ id: string }>(), "garbage")).toEqual({
			ok: false,
			issues: [{ message: "expected an object" }],
		});
		expect(validateSchema(shape<{ id: string }>(), null)).toEqual({
			ok: false,
			issues: [{ message: "expected an object" }],
		});
	});

	it("returns the validated value on success", () => {
		expect(validateSchema(mockSchema(true), { id: "1" })).toEqual({
			ok: true,
			value: { id: "1" },
		});
	});

	it("returns issues on failure", () => {
		expect(validateSchema(mockSchema(false), {})).toEqual({
			ok: false,
			issues: [{ message: "bad" }],
		});
	});

	it("throws on an async schema instead of returning an unresolved verdict", () => {
		const asyncSchema: StandardSchema<{ id: string }> = {
			"~standard": {
				version: 1,
				vendor: "mock",
				validate: (value) =>
					Promise.resolve({ value: value as { id: string } }),
			},
		};

		expect(() => validateSchema(asyncSchema, { id: "1" })).toThrow(
			/asynchronous schema validation is not supported/,
		);
	});
});
