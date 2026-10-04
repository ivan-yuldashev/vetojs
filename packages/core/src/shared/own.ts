import { owns } from "./owns.js";

export const own = <T extends object, K extends keyof T & string>(
	source: T,
	key: K,
): T[K] | undefined => {
	if (!owns(source, key)) {
		return undefined;
	}

	return source[key];
};
