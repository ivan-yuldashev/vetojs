export const only = <T>(items: readonly T[]): T | undefined => {
	return items.length === 1 ? items[0] : undefined;
};
