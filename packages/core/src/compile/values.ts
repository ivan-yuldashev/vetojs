import type { FieldConditionNode, FieldNode, Row } from "../model/index.js";
import { owns } from "../shared/index.js";

export const flattenValues = (
	constraint: FieldConditionNode<Row>,
): FieldNode<Row>[] => {
	if (owns(constraint, "and")) {
		return constraint.and.flatMap(flattenValues);
	}

	return [constraint];
};
