export type Names<K extends string> = {
	[P in K]-?: Record<P, unknown>;
}[K];

type Scalar = string | number | boolean | bigint | Date;

type Eq<V> = {
	eq: V;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Ne<V> = {
	ne: V;
	eq?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type In<V> = {
	in: V[];
	eq?: never;
	ne?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Nin<V> = {
	nin: V[];
	eq?: never;
	ne?: never;
	in?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Gt<V> = {
	gt: V;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Gte<V> = {
	gte: V;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Lt<V> = {
	lt: V;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Lte<V> = {
	lte: V;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Contains = {
	contains: string;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Exists = {
	exists: boolean;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	has?: never;
	hasAny?: never;
	hasAll?: never;
};

type Has<E> = {
	has: E;
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	hasAny?: never;
	hasAll?: never;
};

type HasAny<E> = {
	hasAny: E[];
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAll?: never;
};

type HasAll<E> = {
	hasAll: E[];
	eq?: never;
	ne?: never;
	in?: never;
	nin?: never;
	gt?: never;
	gte?: never;
	lt?: never;
	lte?: never;
	contains?: never;
	exists?: never;
	has?: never;
	hasAny?: never;
};

type ScalarOperators<V> =
	| Eq<V>
	| Ne<V>
	| In<V>
	| Nin<V>
	| Exists
	| (V extends number | Date ? Gt<V> | Gte<V> | Lt<V> | Lte<V> : never)
	| (V extends string ? Contains : never);

type ArrayOperators<E> = Has<E> | HasAny<E> | HasAll<E> | Exists;

export type FieldValue<V> = [Exclude<V, undefined | null>] extends [
	readonly (infer E)[],
]
	? [Exclude<E, undefined | null>] extends [Scalar]
		? ArrayOperators<E>
		: Exists
	: [Exclude<V, undefined | null>] extends [Scalar]
		? V | ScalarOperators<V>
		: Exists;

type ValuesNode<T> = {
	[K in Exclude<keyof T, "and" | "or" | "not">]?: FieldValue<T[K]>;
} & {
	and?: [ValuesCondition<T>, ...ValuesCondition<T>[]];
};

export type ValuesCondition<T> = ValuesNode<T> &
	Names<Exclude<keyof T & string, "and" | "or" | "not"> | "and">;
