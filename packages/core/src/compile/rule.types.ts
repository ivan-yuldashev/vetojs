import type { ConditionNode, FieldNode, Row, Rule } from "../model/index.js";
import type { Matcher } from "../verdict/index.js";

export type CompiledRule = {
	rule: Rule;
	where: ConditionNode<Row> | undefined;
	match: Matcher | undefined;
	fields: readonly string[] | undefined;
	values: ReadonlyMap<string, readonly FieldNode<Row>[]> | undefined;
	isFieldLevel: boolean;
};
