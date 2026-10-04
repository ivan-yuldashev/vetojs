const IDENTIFIER_TYPES: readonly string[] = ["string", "number", "bigint"];

export const isIdentifier = (value: unknown): boolean => {
	return IDENTIFIER_TYPES.includes(typeof value);
};
