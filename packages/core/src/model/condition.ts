import type { ConditionOperator } from "./operator.js";
import type { MatchQuantifier } from "./relation.js";
import type { Row } from "./row.js";

export type FieldNode<T> = {
	field: keyof T & string;
	op: ConditionOperator;
	value: unknown;
};

type RelationNode =
	| {
			relation: string;
			type: "many";
			match: MatchQuantifier;
			where: ConditionNode<Row>;
	  }
	| {
			relation: string;
			type: "one";
			match?: never;
			where: ConditionNode<Row>;
	  };

export type FieldConditionNode<T extends Row> =
	| FieldNode<T>
	| { and: FieldConditionNode<T>[] };

export type WhenNode =
	| FieldNode<Row>
	| { and: WhenNode[] }
	| { or: WhenNode[] }
	| { not: WhenNode };

/**
 * A rule's condition tree: a test on a field, a hop through a relation, or `and` / `or` /
 * `not` over them. Also what {@link Ability.where} returns, for an adapter to turn into
 * a SQL `WHERE`.
 */
export type ConditionNode<T extends Row> =
	| FieldNode<T>
	| RelationNode
	| { and: ConditionNode<T>[] }
	| { or: ConditionNode<T>[] }
	| { not: ConditionNode<T> };
