import type { ConditionNode, RelationKind, Row } from "../model/index.js";
import { relatedOf } from "../row/index.js";
import { owns } from "../shared/index.js";
import type { CompiledRule } from "./rule.types.js";

export type Reach = { relation: string; kind: RelationKind; through: Reach[] };

const groupOf = (
	node: ConditionNode<Row>,
): ConditionNode<Row>[] | undefined => {
	if (owns(node, "and")) {
		return node.and;
	}

	if (owns(node, "or")) {
		return node.or;
	}

	return undefined;
};

const merge = (into: Reach[], node: ConditionNode<Row>): void => {
	if (owns(node, "field")) {
		return;
	}

	const group = groupOf(node);

	if (group !== undefined) {
		for (const child of group) {
			merge(into, child);
		}

		return;
	}

	if (owns(node, "not")) {
		merge(into, node.not);

		return;
	}

	if (!owns(node, "relation")) {
		return;
	}

	let reach = into.find((known) => known.relation === node.relation);

	if (reach === undefined) {
		reach = {
			relation: node.relation,
			kind: node.type,
			through: [],
		};

		into.push(reach);
	}

	merge(reach.through, node.where);
};

export const reachesOf = (rules: readonly CompiledRule[]): Reach[] => {
	const reaches: Reach[] = [];

	for (const rule of rules) {
		if (rule.where === undefined) {
			continue;
		}

		merge(reaches, rule.where);
	}

	return reaches;
};

export const walkReaches = (reaches: readonly Reach[], row: Row): void => {
	for (const reach of reaches) {
		const items = relatedOf(row, reach.relation, reach.kind);

		if (items === null || reach.through.length === 0) {
			continue;
		}

		for (const item of items) {
			walkReaches(reach.through, item);
		}
	}
};
