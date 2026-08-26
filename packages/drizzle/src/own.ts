export const own = <T>(
	source: Record<string, T> | undefined,
	key: string,
): T | undefined => {
	if (source === undefined || !Object.hasOwn(source, key)) {
		return undefined;
	}

	return source[key];
};
