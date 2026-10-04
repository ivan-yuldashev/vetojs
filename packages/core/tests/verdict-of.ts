import type { Ability } from "../src/api/index.js";
import { buildAbility, withEnv } from "../src/api/index.js";
import { compileMatcher } from "../src/compile/index.js";
import type {
	CheckedRules,
	ConditionNode,
	FieldConditionNode,
	Row,
	WhenNode,
} from "../src/model/index.js";

export type Answer = "yes" | "no" | "unknown";

export const node = (field: string, op: string, value: unknown) =>
	({ field, op, value }) as ConditionNode<Row>;

export const HOLDS = node("id", "eq", "p1");
export const FAILS = node("id", "eq", "nobody");

const asked = (ability: Ability, row: Row) => {
	const can = ability.can("update", "post", row);
	const selected =
		compileMatcher(ability.where("update", "post"))(row) === true;

	if (can !== selected) {
		throw new Error(`can() says ${can}, where() selects ${selected}`);
	}

	return can;
};

export const answerOf = (where: ConditionNode<Row>, row: Row): Answer => {
	const permission = buildAbility({}, [
		{ effect: "allow", action: "update", resource: "post", where },
	] as unknown as CheckedRules);
	const prohibition = buildAbility({}, [
		{ effect: "allow", action: "update", resource: "post" },
		{ effect: "deny", action: "update", resource: "post", where },
	] as unknown as CheckedRules);

	const granted = asked(permission, row);
	const left = asked(prohibition, row);

	if (granted && left) {
		throw new Error("the permission grants and the prohibition does not fire");
	}

	if (granted) {
		return "yes";
	}

	return left ? "no" : "unknown";
};

const bound = (rules: unknown[], env: unknown): Ability =>
	withEnv(buildAbility({}, rules as CheckedRules) as never, env as never);

export const whenAnswerOf = (when: WhenNode, env: unknown): Answer => {
	const row = { id: "p1" };
	const takesPart = asked(
		bound([{ effect: "allow", action: "update", resource: "post", when }], env),
		row,
	);
	const stands = !asked(
		bound(
			[
				{ effect: "allow", action: "update", resource: "post" },
				{ effect: "deny", action: "update", resource: "post", when },
			],
			env,
		),
		row,
	);

	if (takesPart && !stands) {
		throw new Error("the allow takes part and the deny does not");
	}

	if (takesPart) {
		return "yes";
	}

	return stands ? "unknown" : "no";
};

export const sparse = (length: number, filled: Record<number, unknown>) =>
	Object.assign(new Array<unknown>(length), filled);

export type ValueAnswer = Answer | "free";

const fieldsRefused = (
	ability: Ability,
	row: Row | undefined,
	data: Row,
	reason: string,
): Set<string> => {
	const result = ability.validatePayload("update", "post", row, data);

	if (result.ok) {
		return new Set();
	}

	if (result.violations.length === 0) {
		throw new Error("the write was refused as a whole");
	}

	for (const violation of result.violations) {
		if (violation.reason !== reason) {
			throw new Error(`${violation.field}: ${violation.reason}`);
		}
	}

	return new Set(result.violations.map((violation) => violation.field));
};

const valueAnswer = (isRefused: boolean, isDenied: boolean): ValueAnswer => {
	if (isRefused) {
		return isDenied ? "unknown" : "no";
	}

	return isDenied ? "yes" : "free";
};

export const valuesAnswerOf = (
	values: FieldConditionNode<Row>,
	data: Row,
	row: Row | undefined,
): Record<string, ValueAnswer> => {
	const permission: Ability = buildAbility({}, [
		{ effect: "allow", action: "update", resource: "post", values },
	] as unknown as CheckedRules);
	const prohibition: Ability = buildAbility({}, [
		{ effect: "allow", action: "update", resource: "post" },
		{ effect: "deny", action: "update", resource: "post", values },
	] as unknown as CheckedRules);

	for (const ability of [permission, prohibition]) {
		const where = JSON.stringify(ability.where("update", "post"));

		if (!ability.canMutate("update", "post", row) || where !== '{"and":[]}') {
			throw new Error("a value constraint reached the row");
		}
	}

	const refused = fieldsRefused(permission, row, data, "value not permitted");
	const denied = fieldsRefused(prohibition, row, data, "value denied");

	return Object.fromEntries(
		Object.keys(data).map((field) => [
			field,
			valueAnswer(refused.has(field), denied.has(field)),
		]),
	);
};
