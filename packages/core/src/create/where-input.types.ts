import type { FieldValue, Names } from "./condition-shorthand.types.js";
import type {
	ResourceMap,
	ResourceName,
	ShapeOf,
} from "./define-abilities.types.js";

type Rels<AC extends ResourceMap, R extends ResourceName<AC>> = AC[R] extends {
	relations: infer X;
}
	? X
	: Record<never, never>;

type Group = "and" | "or" | "not";

export type StatedKey =
	"veto: a condition has to name at least one field, relation or group";

type Quantifier<AC extends ResourceMap, R extends ResourceName<AC>> = {
	some?: WhereInput<AC, R>;
	every?: WhereInput<AC, R>;
	none?: WhereInput<AC, R>;
} & Names<"some" | "every" | "none">;

type RelationValue<AC extends ResourceMap, Relation> = Relation extends {
	kind: infer Kind;
	resource: infer RR extends ResourceName<AC>;
}
	? Kind extends "one"
		? WhereInput<AC, RR>
		: Quantifier<AC, RR>
	: never;

export type WhereKeys<AC extends ResourceMap, R extends ResourceName<AC>> = (
	| Exclude<keyof ShapeOf<AC, R>, Group>
	| keyof Rels<AC, R>
	| Group
) &
	string;

type WhereValue<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
	K extends string,
> = K extends Group
	? K extends "not"
		? WhereInput<AC, R>
		: [WhereInput<AC, R>, ...WhereInput<AC, R>[]]
	: K extends keyof Rels<AC, R>
		? RelationValue<AC, Rels<AC, R>[K]>
		: K extends keyof ShapeOf<AC, R>
			? FieldValue<ShapeOf<AC, R>[K]>
			: never;

export type WhereNode<AC extends ResourceMap, R extends ResourceName<AC>> = {
	[K in WhereKeys<AC, R>]?: WhereValue<AC, R, K>;
};

type WhereInput<AC extends ResourceMap, R extends ResourceName<AC>> = WhereNode<
	AC,
	R
> &
	Names<WhereKeys<AC, R>>;
