import type { ConditionNode } from "../model/index.js";
import type { Row } from "../shared/index.js";
import { relatedOf } from "./read.js";

export type Reach = { relation: string; through: Reach[] };

const merge = (into: Reach[], node: ConditionNode<Row>): void => {
	if ("and" in node) {
		for (const child of node.and) {
			merge(into, child);
		}

		return;
	}

	if ("or" in node) {
		for (const child of node.or) {
			merge(into, child);
		}

		return;
	}

	if ("not" in node) {
		merge(into, node.not);

		return;
	}

	if (!("relation" in node)) {
		return;
	}

	let reach = into.find((known) => known.relation === node.relation);

	if (reach === undefined) {
		reach = { relation: node.relation, through: [] };
		into.push(reach);
	}

	merge(reach.through, node.where);
};

export const reachesOf = (nodes: ConditionNode<Row>[]): Reach[] => {
	const reaches: Reach[] = [];

	for (const node of nodes) {
		merge(reaches, node);
	}

	return reaches;
};

export const walkReaches = (reaches: Reach[], instance: Row): void => {
	for (const reach of reaches) {
		const related = relatedOf(instance, reach.relation);

		if (related === null || reach.through.length === 0) {
			continue;
		}

		for (const item of related.items) {
			walkReaches(reach.through, item);
		}
	}
};
