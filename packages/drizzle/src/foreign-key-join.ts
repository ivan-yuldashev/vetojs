import { RelationKind } from "@vetojs/core";
import {
	and,
	type Column,
	eq,
	getTableColumns,
	getTableName,
	type Table,
} from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type { JoinPredicate, JoinResolution } from "./compile.js";
import { own } from "./own.js";

const columnKey = (table: Table, column: Column): string => {
	for (const [key, candidate] of Object.entries(getTableColumns(table))) {
		if (candidate === column) {
			return key;
		}
	}

	throw new Error(
		`@vetojs/drizzle: column "${column.name}" is not part of table "${getTableName(table)}" — inconsistent foreign-key metadata.`,
	);
};

const requiredColumn = (table: Table, key: string): Column => {
	const column = own(getTableColumns(table), key);

	if (column === undefined) {
		throw new Error(
			`@vetojs/drizzle: column key "${key}" is missing on table "${getTableName(table)}" — the alias lost a column.`,
		);
	}

	return column;
};

export const deriveJoinFromForeignKeys = (
	parent: PgTable,
	child: PgTable,
	kind: RelationKind,
): JoinResolution => {
	const [owner, target] =
		kind === RelationKind.Many ? [child, parent] : [parent, child];

	const references = getTableConfig(owner)
		.foreignKeys.map((foreignKey) => foreignKey.reference())
		.filter((reference) => reference.foreignTable === target);

	const [reference] = references;

	if (reference === undefined) {
		return {
			unavailable: `no foreign key from "${getTableName(owner)}" to "${getTableName(target)}"`,
		};
	}

	if (references.length > 1) {
		return {
			unavailable: `${references.length} foreign keys from "${getTableName(owner)}" to "${getTableName(target)}" — ambiguous`,
		};
	}

	const pairs = reference.columns.map((column, index) => {
		const targetColumn = reference.foreignColumns[index];

		if (targetColumn === undefined) {
			throw new Error(
				`@vetojs/drizzle: the foreign key on "${getTableName(owner)}" pairs ${reference.columns.length} columns with ${reference.foreignColumns.length} — inconsistent metadata.`,
			);
		}

		return {
			ownerKey: columnKey(owner, column),
			targetKey: columnKey(target, targetColumn),
		};
	});

	const join: JoinPredicate = (parentRuntime, childRuntime) => {
		const [ownerRuntime, targetRuntime] =
			kind === RelationKind.Many
				? [childRuntime, parentRuntime]
				: [parentRuntime, childRuntime];

		const [first, ...rest] = pairs.map(({ ownerKey, targetKey }) =>
			eq(
				requiredColumn(ownerRuntime, ownerKey),
				requiredColumn(targetRuntime, targetKey),
			),
		);

		if (first === undefined) {
			throw new Error(
				`@vetojs/drizzle: the foreign key on "${getTableName(owner)}" pairs no columns — inconsistent metadata.`,
			);
		}

		return rest.length === 0 ? first : (and(first, ...rest) ?? first);
	};

	return { join };
};
