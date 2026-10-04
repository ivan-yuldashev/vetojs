import { isPlainObject } from "../shared/index.js";
import type {
	AnySchema,
	Schema,
	SchemaIssue,
	StandardIssue,
	ValidateResult,
} from "./schema.types.js";

const passthrough = (value: unknown): unknown => value;

/**
 * Declares a resource's shape, carrying `T` into the type system at zero runtime cost.
 *
 * Pass a [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType) instead when
 * you also want `ability.validate` to check incoming data at runtime.
 *
 * @example
 * schema: shape<{ id: string; authorId: string }>()
 */
export const shape = <T>(): Schema<T> => passthrough;

const toIssue = (issue: StandardIssue): SchemaIssue => {
	if (issue.path === undefined) {
		return { message: issue.message };
	}

	return {
		message: issue.message,
		path: issue.path.map((segment) =>
			segment !== null && typeof segment === "object" ? segment.key : segment,
		),
	};
};

export const validateSchema = (
	schema: AnySchema | undefined,
	data: unknown,
): ValidateResult<Record<string, unknown>> => {
	if (typeof schema !== "object" || !("~standard" in schema)) {
		return isPlainObject(data)
			? { ok: true, value: data }
			: { ok: false, issues: [{ message: "expected an object" }] };
	}

	const result = schema["~standard"].validate(data);

	if (result instanceof Promise) {
		throw new Error(
			"veto: asynchronous schema validation is not supported (validate returned a Promise).",
		);
	}

	if (result.issues) {
		return { ok: false, issues: result.issues.map(toIssue) };
	}

	return { ok: true, value: result.value };
};
