import type { ConditionNode, FieldConditionNode } from "./condition.js";
import type { RuleEffect } from "./effect.js";
import type { Row } from "./row.js";

/**
 * One rule as plain JSON — the form that crosses the server/client boundary and stores in a
 * database.
 *
 * `where` says which rows it speaks about, `fields` which columns of them, and `values` what
 * those columns may be set to. All three absent means the whole resource.
 */
export type Rule<T extends Row = Row> = {
	effect: RuleEffect;
	action: string | [string, ...string[]];
	resource: string;
	where?: ConditionNode<T>;
	fields?: readonly [FieldName<T>, ...FieldName<T>[]];
	values?: FieldConditionNode<Partial<T>>;
};

type FieldName<T extends Row> = Exclude<keyof T & string, "">;
