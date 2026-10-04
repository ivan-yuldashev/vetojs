import type {
	Ability,
	ConditionNode,
	DeclaredAction,
	ResourceMap,
	ResourceName,
	ShapeOf,
} from "@vetojs/core";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

type RelationsOf<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
> = NonNullable<AC[R]["relations"]>;

type TargetOf<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
	Rel extends keyof RelationsOf<AC, R>,
> = RelationsOf<AC, R>[Rel] extends { resource: infer T }
	? T & ResourceName<AC>
	: never;

type TableFor<Shape> = PgTable & {
	readonly $inferSelect: { [K in keyof Shape & string]: unknown };
};

/**
 * One table per resource, checked against the resource's declared shape.
 *
 * The map is total: every resource needs an entry, so adding one to `defineAbilities` and
 * forgetting it here is a compile error. A resource with no rows behind it — a screen gated
 * by policy alone — is declared `null`, which says so deliberately rather than by omission.
 */
export type TableMap<AC extends ResourceMap> = {
	[R in ResourceName<AC>]: TableFor<ShapeOf<AC, R>> | null;
};

/**
 * Join predicates for relations a foreign key cannot express, keyed by resource and relation.
 *
 * Optional throughout: a relation whose tables are connected by exactly one foreign key
 * needs nothing here. Each callback receives the two tables it joins — the parent and the
 * aliased child — so self-relations and nesting stay correct.
 *
 * @example
 * defineTables(ac, tables, {
 * 	post: { comments: (post, comment) => sql`${comment.postId} = ${post.id} and not ${comment.deleted}` },
 * });
 */
export type JoinsFor<AC extends ResourceMap, M extends TableMap<AC>> = {
	[R in ResourceName<AC>]?: {
		[Rel in keyof RelationsOf<AC, R> & string]?: (
			parent: NonNullable<M[R]>,
			child: NonNullable<M[TargetOf<AC, R, Rel>]>,
		) => SQL;
	};
};

/** What {@link defineTables} returns: the policy, ready to become a `WHERE`. */
export type DrizzleSchema<AC extends ResourceMap> = {
	/**
	 * Compiles a policy into a `WHERE` that selects exactly the rows `can()` allows.
	 *
	 * Name the action and resource, or pass a condition you already have. Trailing
	 * predicates are your own — a row id, a search term — and are ANDed with the policy, so
	 * this call can only narrow the result, never widen it. Passing them here also keeps the
	 * type `SQL`, where Drizzle's own `and` answers `SQL | undefined`.
	 *
	 * @throws when a rule has no honest two-valued SQL form — an unknown column, an operator
	 * or quantifier the engine answers as unknown, a relation without a join.
	 *
	 * @example
	 * db.select().from(posts).where(schema.filter(ability, "read", "post"));
	 * db.select().from(posts).where(schema.filter(ability, "read", "post", eq(posts.id, id)));
	 */
	filter: {
		<R extends ResourceName<AC>>(
			resource: R,
			condition: ConditionNode<ShapeOf<AC, R>>,
			...narrow: SQLWrapper[]
		): SQL;
		<R extends ResourceName<AC>>(
			ability: Ability<AC>,
			action: DeclaredAction<AC, R>,
			resource: R,
			...narrow: SQLWrapper[]
		): SQL;
	};
};
