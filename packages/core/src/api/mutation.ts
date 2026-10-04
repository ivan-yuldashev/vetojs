import { checkField, checkRow, wheresOf } from "../check/index.js";
import type { RulesByEffect } from "../compile/index.js";
import type { Row } from "../model/index.js";
import { isPlainObject, isProtoKey } from "../shared/index.js";
import type { PayloadResult, PayloadViolation } from "./mutation.types.js";

export const permittedFields = <F extends string>(
	selected: RulesByEffect,
	row: Row | undefined,
	fields: readonly F[],
): F[] => {
	if (checkRow(selected, row, false).verdict === false) {
		return [];
	}

	const wheres = wheresOf(selected, row);

	return fields.filter(
		(field) =>
			!isProtoKey(field) &&
			(checkField(selected, wheres, field, undefined, false).verdict ??
				row === undefined),
	);
};

export const validatePayload = (
	selected: RulesByEffect,
	row: Row | undefined,
	data: unknown,
): PayloadResult<Row> => {
	if (!isPlainObject(data) || checkRow(selected, row, false).verdict !== true) {
		return { ok: false, violations: [] };
	}

	const wheres = wheresOf(selected, row);
	const approved: Row = {};
	const violations: PayloadViolation[] = [];

	for (const [field, value] of Object.entries(data)) {
		if (
			!isProtoKey(field) &&
			checkField(selected, wheres, field, data, false).verdict === true
		) {
			approved[field] = value;
			continue;
		}

		if (
			isProtoKey(field) ||
			checkField(selected, wheres, field, undefined, false).verdict !== true
		) {
			violations.push({ field, reason: "field not permitted" });
			continue;
		}

		const { denyRule } = checkField(selected, wheres, field, data, true);

		violations.push({
			field,
			reason: denyRule === undefined ? "value not permitted" : "value denied",
		});
	}

	return violations.length > 0
		? { ok: false, violations }
		: { ok: true, data: approved };
};
