import type { CompiledRule, RulesByEffect } from "../compile/index.js";
import { walkReaches } from "../compile/index.js";
import type { FieldNode, Row } from "../model/index.js";
import { isRow } from "../shared/index.js";
import {
	evaluateOperator,
	kleeneAndOver,
	type Verdict,
} from "../verdict/index.js";
import type { CheckResult, Wheres } from "./rule.types.js";

type Judge<Context> = (
	compiled: CompiledRule,
	index: number,
	context: Context,
) => Verdict;

type FieldContext = {
	wheres: Wheres;
	field: string;
	payload: Row | undefined;
};

const RULES = {
	allowRule: undefined,
	denyRule: undefined,
};

const REFUSED: CheckResult = {
	verdict: false,
	...RULES,
};

const OPEN: CheckResult = {
	verdict: undefined,
	...RULES,
};

const GRANTED: CheckResult = {
	verdict: true,
	...RULES,
};

const INVALID_ROW: CheckResult = {
	verdict: false,
	reason: "not a plain row",
	...RULES,
};

const both = (left: Verdict, right: Verdict): Verdict => {
	if (left === false || right === false) {
		return false;
	}

	return left === undefined || right === undefined ? undefined : true;
};

const whereVerdict = (
	compiled: CompiledRule,
	row: Row | undefined,
): Verdict => {
	if (compiled.match === undefined) {
		return true;
	}

	return row === undefined ? undefined : compiled.match(row);
};

const judgeRow: Judge<Row | undefined> = (compiled, _index, row) => {
	return whereVerdict(compiled, row);
};

const holds = (constraint: FieldNode<Row>, value: unknown): Verdict => {
	return evaluateOperator(constraint.op, value, constraint.value);
};

const valueVerdict = (
	compiled: CompiledRule,
	{ field, payload }: FieldContext,
): Verdict | null => {
	const constraints = compiled.values?.get(field);

	if (constraints === undefined || payload === undefined) {
		return null;
	}

	return kleeneAndOver(constraints, holds, payload[field]);
};

const judgeAllowedField: Judge<FieldContext> = (compiled, index, context) => {
	const where = context.wheres.allow[index];

	if (where === false) {
		return false;
	}

	if (
		compiled.fields !== undefined &&
		!compiled.fields.includes(context.field)
	) {
		return false;
	}

	const value = valueVerdict(compiled, context);

	return value === null ? where : both(where, value);
};

const judgeDeniedField: Judge<FieldContext> = (compiled, index, context) => {
	const where = context.wheres.deny[index];

	if (where === false || !compiled.isFieldLevel) {
		return where;
	}

	if (compiled.fields?.includes(context.field)) {
		return where;
	}

	const value = valueVerdict(compiled, context);

	return value === null ? false : both(where, value);
};

const resultOf = <Context>(
	allow: readonly CompiledRule[],
	deny: readonly CompiledRule[],
	judgeAllow: Judge<Context>,
	judgeDeny: Judge<Context>,
	context: Context,
	explain: boolean,
): CheckResult => {
	let openDeny: CompiledRule | undefined;
	let index = 0;

	for (const compiled of deny) {
		const verdict = judgeDeny(compiled, index++, context);

		if (verdict === true) {
			return explain
				? { verdict: false, allowRule: undefined, denyRule: compiled.rule }
				: REFUSED;
		}

		if (verdict === undefined && openDeny === undefined) {
			openDeny = compiled;
		}
	}

	let settling: CompiledRule | undefined;
	let allowed: Verdict = false;

	index = 0;

	for (const compiled of allow) {
		const verdict = judgeAllow(compiled, index++, context);

		if (verdict === true) {
			settling = compiled;
			allowed = true;
			break;
		}

		if (verdict === undefined && settling === undefined) {
			settling = compiled;
			allowed = undefined;
		}
	}

	if (allowed === false) {
		return REFUSED;
	}

	if (!explain) {
		return allowed === undefined || openDeny !== undefined ? OPEN : GRANTED;
	}

	return {
		verdict: allowed === undefined || openDeny !== undefined ? undefined : true,
		allowRule: settling?.rule,
		denyRule: openDeny?.rule,
	};
};

export const checkRow = (
	selected: RulesByEffect,
	row: Row | undefined,
	explain: boolean,
): CheckResult => {
	if (row !== undefined) {
		if (!isRow(row)) {
			return INVALID_ROW;
		}

		walkReaches(selected.reaches, row);
	}

	return resultOf(
		selected.allow,
		selected.rowDeny,
		judgeRow,
		judgeRow,
		row,
		explain,
	);
};

export const wheresOf = (
	selected: RulesByEffect,
	row: Row | undefined,
): Wheres => {
	return {
		allow: selected.allow.map((compiled) => whereVerdict(compiled, row)),
		deny: selected.deny.map((compiled) => whereVerdict(compiled, row)),
	};
};

export const checkField = (
	selected: RulesByEffect,
	wheres: Wheres,
	field: string,
	payload: Row | undefined,
	explain: boolean,
): CheckResult => {
	return resultOf(
		selected.allow,
		selected.deny,
		judgeAllowedField,
		judgeDeniedField,
		{ wheres, field, payload },
		explain,
	);
};
