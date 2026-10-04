import { describe, expect, it } from "vitest";
import { compileRule } from "../../src/compile/rule.js";
import type {
	ConditionNode,
	FieldConditionNode,
	Row,
	Rule,
} from "../../src/model/index.js";

const MINE: ConditionNode<Row> = { field: "authorId", op: "eq", value: "u1" };
const DRAFT: FieldConditionNode<Row> = {
	field: "status",
	op: "eq",
	value: "draft",
};

type Shape = Pick<Rule, "where" | "fields" | "values">;

const compiledOf = (effect: "allow" | "deny", shape: Shape) => {
	const rule = { effect, action: "update", resource: "post", ...shape } as Rule;

	return { rule, compiled: compileRule(rule) };
};

// DONE: проверить все тестовые файлы на предмет не обоснованого удаления. Есть защита типами, а есть не доверенный ввод: строки, связи в рантайме могут прийти любыми. Есть ощущение, что мы удалили лишнее в этом цикле (проверить весь diff) — проверен весь diff тестов против aeecaad и удаления в самом aeecaad. Удалены только тесты на правила, которых не получить ни типами, ни parseRules: эффект не allow/deny, пустой и отсутствующий action, where без формы, связь без where (entity-level, field-level, policy-snapshot, where-logic, where-relations, matcher, select), а в aeecaad — скомпилированный узел, переданный createRules как шортхэнд. Недоверенный ввод не тронут: строки из запроса (имя ресурса и действия, __proto__, constructor — policy-snapshot, polluted-prototype), ряды и связи в них (не загружена, дыры, идентификаторы, не-ряд — where-relations, reads, relation-shape, check/rule), env (when-level, with-env), payload (mutation, values-*). Два юнит-кейса про payload без поля и payload не-объект, снятые в aeecaad, покрыты на уровне API в mutation.test («data that is a class instance» и соседние, «reads the data's own keys, not what it inherits»). Неизвестные квантор и оператор остались — их ответ описан в docs/drizzle.md. Остальное в diff — перенос юнит-тестов отсюда в check/rule.test без потери утверждений: «правило молчит» переведено в «allow пропускает, deny не срабатывает». Нашёлся один реальный сдвиг — в хелпере check/rule.test, см. DONE там
describe("what a compiled rule remembers about itself", () => {
	it.each([
		["allow", {}, false],
		["deny", {}, false],
		["allow", { where: MINE }, false],
		["deny", { where: MINE }, false],
		["allow", { fields: ["status"] }, true],
		["deny", { fields: ["status"] }, true],
		["allow", { values: DRAFT }, true],
		["deny", { values: DRAFT }, true],
		["deny", { where: MINE, fields: ["status"] }, true],
		["deny", { where: MINE, values: DRAFT }, true],
	] as [
		"allow" | "deny",
		Shape,
		boolean,
	][])("%s %j: field level %s", (effect, shape, isFieldLevel) => {
		const { rule, compiled } = compiledOf(effect, shape);

		expect(compiled.rule).toBe(rule);
		expect(compiled.isFieldLevel).toBe(isFieldLevel);
		expect(compiled.where).toBe(shape.where);
		expect(compiled.match === undefined).toBe(shape.where === undefined);
		expect(compiled.fields).toBe(shape.fields);
	});

	it("files value constraints under the field they constrain, every and flattened", () => {
		const { compiled } = compiledOf("allow", {
			values: {
				and: [
					{ field: "title", op: "contains", value: "a" },
					{ and: [DRAFT, { field: "title", op: "contains", value: "b" }] },
				],
			},
		});

		expect(compiled.values).toEqual(
			new Map([
				[
					"title",
					[
						{ field: "title", op: "contains", value: "a" },
						{ field: "title", op: "contains", value: "b" },
					],
				],
				["status", [DRAFT]],
			]),
		);
	});
});
