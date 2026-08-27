import { isPlainObject } from "./isPlainObject.js";
import { owns } from "./owns.js";

export const saysNothing = (node: unknown): boolean => {
	return (
		isPlainObject(node) &&
		owns(node, "and") &&
		Array.isArray(node.and) &&
		node.and.length === 0
	);
};
