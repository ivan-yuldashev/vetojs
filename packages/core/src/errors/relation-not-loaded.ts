/**
 * Thrown when a condition reaches into a relation that was never loaded.
 *
 * Missing data is a bug in your query, not a reason to deny quietly: treating it as
 * "does not match" would turn a forgotten `include` into a silent policy change.
 */
export class RelationNotLoadedError extends Error {
	readonly relation: string;

	constructor(relation: string) {
		super(
			`Relation "${relation}" is referenced by a condition but is not loaded on the row. Load it (include/with) before checking.`,
		);

		this.name = "RelationNotLoadedError";
		this.relation = relation;
	}
}
