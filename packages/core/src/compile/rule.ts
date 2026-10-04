import type {
	FieldConditionNode,
	FieldNode,
	Row,
	Rule,
} from "../model/index.js";
import { own } from "../shared/index.js";
import { compileMatcher } from "./matcher.js";
import type { CompiledRule } from "./rule.types.js";
import { flattenValues } from "./values.js";

const valuesByField = (
	values: FieldConditionNode<Row>,
): Map<string, FieldNode<Row>[]> => {
	const byField = new Map<string, FieldNode<Row>[]>();

	for (const constraint of flattenValues(values)) {
		const known = byField.get(constraint.field);

		if (known === undefined) {
			byField.set(constraint.field, [constraint]);
			continue;
		}

		known.push(constraint);
	}

	return byField;
};

export const compileRule = (rule: Rule): CompiledRule => {
	const where = own(rule, "where");
	const fields = own(rule, "fields");
	const values = own(rule, "values");

	return {
		rule,
		where,
		match: where === undefined ? undefined : compileMatcher(where),
		fields,
		values: values === undefined ? undefined : valuesByField(values),
		isFieldLevel: fields !== undefined || values !== undefined,
	};
};
