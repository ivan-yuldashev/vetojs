import type { MANAGE_ACTION, RelationKind } from "../model/index.js";
import type { AnySchema, InferSchema } from "./schema.types.js";

export type Relation<R extends string = string> = {
	resource: R;
	kind: RelationKind;
};

export type ResourceDefinition<R extends string = string> = {
	/**
	 * The row shape — {@link shape} for a type alone, or a Standard Schema validator when
	 * `ability.validate` should check incoming data.
	 *
	 * Leave it out for a resource that has no rows, such as a screen or a report. The shape
	 * is then empty: no row can be passed by mistake and no field condition can be written.
	 */
	schema?: AnySchema;
	actions: readonly string[];
	relations?: Record<string, Relation<R>>;
};

/**
 * Every resource an app knows, keyed by name — what {@link defineAbilities} returns, and the
 * first thing every other type here is bound to.
 */
export type ResourceMap = Record<string, ResourceDefinition>;

/** The name of one resource in `T`. */
export type ResourceName<T extends ResourceMap> = keyof T & string;

/**
 * The actions `R` declares — what a question may name. `"manage"` is not one of them: in a
 * rule it stands for all of them, and a question names the action it asks about.
 */
export type DeclaredAction<
	T extends ResourceMap,
	R extends keyof T,
> = T[R]["actions"][number];

/**
 * The actions `R` declares, plus `"manage"` — the wildcard a rule may name for all of them.
 */
export type ActionFor<T extends ResourceMap, R extends keyof T> =
	| DeclaredAction<T, R>
	| typeof MANAGE_ACTION;

type EmptyShape = Record<string, never>;

type SchemaOf<T extends ResourceMap, R extends keyof T> = Extract<
	T[R]["schema"],
	AnySchema
>;

/**
 * The row shape `R` was declared with, inferred from its schema. A resource declared
 * without one has an empty shape: no row to pass, no field to write a condition against.
 */
export type ShapeOf<T extends ResourceMap, R extends keyof T> = [
	SchemaOf<T, R>,
] extends [never]
	? EmptyShape
	: InferSchema<SchemaOf<T, R>>;

export type FieldName<T extends ResourceMap, R extends keyof T> = Exclude<
	keyof ShapeOf<T, R> & string,
	""
>;
