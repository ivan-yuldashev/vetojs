import { RelationNotLoadedError } from "../errors/index.js";
import { RelationKind, type Row } from "../model/index.js";
import { isIdentifier, isRow, own } from "../shared/index.js";

const areRows = (items: readonly unknown[]): items is Row[] => {
	for (const item of items) {
		if (!isRow(item)) {
			return false;
		}
	}

	return true;
};

export const relatedOf = (
	row: Row,
	relation: string,
	kind: RelationKind,
): Row[] | null => {
	const related = own(row, relation);

	if (related === undefined) {
		throw new RelationNotLoadedError(relation);
	}

	if (related === null || related === undefined) {
		return [];
	}

	const isList = Array.isArray(related);
	const items: unknown[] = isList ? related : [related];

	if (items.some(isIdentifier)) {
		throw new RelationNotLoadedError(relation);
	}

	return isList === (kind === RelationKind.Many) && areRows(items)
		? items
		: null;
};
