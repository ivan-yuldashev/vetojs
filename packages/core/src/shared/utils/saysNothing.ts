import { isPlainObject } from "./isPlainObject.js";

export const saysNothing = (node: unknown): boolean => {
	return (
		isPlainObject(node) && Array.isArray(node.and) && node.and.length === 0
	);
};
