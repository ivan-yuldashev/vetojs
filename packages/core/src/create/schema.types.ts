/**
 * A row shape carried in the types alone — what {@link shape} builds. At runtime it only
 * refuses a non-object; declare a Standard Schema instead where `ability.validate` should
 * check the fields.
 */
export type Schema<T> = ((value: unknown) => unknown) & {
	readonly "~veto.shape"?: T;
};

export type StandardSchema<Output = unknown> = {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) => StandardResult<Output> | Promise<StandardResult<Output>>;
		readonly types?:
			| { readonly input: unknown; readonly output: Output }
			| undefined;
	};
};

type StandardPathSegment = PropertyKey | { readonly key: PropertyKey };

export type StandardIssue = {
	readonly message: string;
	readonly path?: ReadonlyArray<StandardPathSegment> | undefined;
};

type StandardResult<Output> =
	| { readonly value: Output; readonly issues?: undefined }
	| { readonly issues: ReadonlyArray<StandardIssue> };

export type AnySchema =
	| Schema<Record<string, unknown>>
	| StandardSchema<Record<string, unknown>>;

export type InferSchema<S> = S extends StandardSchema
	? NonNullable<S["~standard"]["types"]>["output"]
	: S extends Schema<infer T>
		? T
		: never;

/**
 * One thing the schema rejected: what was wrong, and where.
 *
 * `path` is the field it happened on — `["views"]`, or `["meta", "a"]` when nested. It is
 * absent when the schema blamed the value as a whole, and always absent for a resource
 * declared with {@link shape} alone, which only ever rejects non-objects.
 */
export type SchemaIssue = { message: string; path?: PropertyKey[] };

/**
 * What {@link Ability.validate} answers: the data typed as the resource's shape, or every
 * {@link SchemaIssue} the schema raised.
 */
export type ValidateResult<T> =
	| { ok: true; value: T }
	| { ok: false; issues: SchemaIssue[] };
