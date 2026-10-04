/** How many rows a declared relation holds. */
export const RelationKind = {
	One: "one",
	Many: "many",
} as const;

export type RelationKind = (typeof RelationKind)[keyof typeof RelationKind];

export const RELATION_KINDS: readonly RelationKind[] =
	Object.values(RelationKind);

/** How many of a `many` relation's rows a condition has to match. */
export const MatchQuantifier = {
	Some: "some",
	Every: "every",
	None: "none",
} as const;

export type MatchQuantifier =
	(typeof MatchQuantifier)[keyof typeof MatchQuantifier];

export const MATCH_QUANTIFIERS: readonly MatchQuantifier[] =
	Object.values(MatchQuantifier);

export const isQuantifier = (match: unknown): match is MatchQuantifier => {
	return MATCH_QUANTIFIERS.some((known) => known === match);
};
