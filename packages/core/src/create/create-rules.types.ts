import type { CheckedRule, RuleEffect } from "../model/index.js";
import type { ValuesCondition } from "./condition-shorthand.types.js";
import type {
	ActionFor,
	EnvOf,
	FieldName,
	ResourceMap,
	ResourceName,
	ShapeOf,
} from "./define-abilities.types.js";
import type {
	StatedKey,
	WhenInput,
	WhereKeys,
	WhereNode,
} from "./where-input.types.js";

type FieldTarget<AC extends ResourceMap> = {
	readonly [R in ResourceName<AC>]?: readonly [
		FieldName<AC, R>,
		...FieldName<AC, R>[],
	];
};

type TargetInput<AC extends ResourceMap> = ResourceName<AC> | FieldTarget<AC>;

type Actions<AC extends ResourceMap, R extends ResourceName<AC>> =
	| ActionFor<AC, R>
	| [ActionFor<AC, R>, ...ActionFor<AC, R>[]];

type Joined<U> = (U extends unknown ? (key: U) => void : never) extends (
	key: infer I,
) => void
	? I
	: never;

type NameOf<AC extends ResourceMap, T> =
	T extends ResourceName<AC>
		? T
		: [keyof T] extends [Joined<keyof T>]
			? undefined extends T[keyof T]
				? never
				: keyof T & ResourceName<AC>
			: never;

type FieldsOf<AC extends ResourceMap, T> =
	T extends ResourceName<AC>
		? FieldName<AC, T>
		: T[keyof T] extends readonly (infer E)[]
			? E & string
			: never;

type ValuedFields<
	AC extends ResourceMap,
	T,
	E extends RuleEffect,
> = E extends "allow" ? FieldsOf<AC, T> : FieldName<AC, NameOf<AC, T>>;

type Values<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
	F extends string,
> = ValuesCondition<Partial<Pick<ShapeOf<AC, R>, F & FieldName<AC, R>>>>;

type Where<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
	WK extends WhereKeys<AC, R> | StatedKey,
> = WhereNode<AC, R> & Record<WK, unknown>;

type When<AC extends ResourceMap> = [EnvOf<AC>] extends [never]
	? never
	: WhenInput<EnvOf<AC>>;

type Options<
	AC extends ResourceMap,
	T,
	WK extends WhereKeys<AC, NameOf<AC, T>> | StatedKey,
	F extends string,
> = {
	where?: Where<AC, NameOf<AC, T>, WK>;
	values?: Values<AC, NameOf<AC, T>, F>;
	when?: When<AC>;
};

export type RuleFactory<AC extends ResourceMap, E extends RuleEffect> = <
	const T extends TargetInput<AC>,
	WK extends WhereKeys<AC, NameOf<AC, T>> | StatedKey = StatedKey,
>(
	action: Actions<AC, NameOf<AC, T>>,
	target: T,
	options?: Options<AC, T, WK, ValuedFields<AC, T, E>>,
) => CheckedRule;
