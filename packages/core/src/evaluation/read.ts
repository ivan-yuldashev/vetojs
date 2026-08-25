import { RelationNotLoadedError } from "../errors/index.js";
import {
	FOREIGN_KEY_TYPES,
	isPlainObject,
	own,
	type Row,
} from "../shared/index.js";
import { isLoaded } from "./loaded.js";

export const ownField = (instance: Row, key: string): unknown => {
	return own(instance, key);
};

export type Related = { items: Row[]; asList: boolean };

export const relatedOf = (instance: Row, relation: string): Related | null => {
	const related = ownField(instance, relation);

	if (related === undefined && !isLoaded(instance, relation)) {
		throw new RelationNotLoadedError(relation);
	}

	if (related === null || related === undefined) {
		return { items: [], asList: false };
	}

	const asList = Array.isArray(related);
	const raw = asList ? related : [related];
	const items: Row[] = [];

	for (const item of raw) {
		if (isPlainObject(item)) {
			items.push(item);
			continue;
		}

		if (FOREIGN_KEY_TYPES.includes(typeof item)) {
			throw new RelationNotLoadedError(relation);
		}

		return null;
	}

	return { items, asList };
};
