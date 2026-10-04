import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { buildAbility, type Decision } from "../../src/api/index.js";
import {
	createRules,
	defineAbilities,
	type StandardSchema,
	shape,
} from "../../src/create/index.js";
import { ForbiddenError } from "../../src/errors/index.js";
import { createGuard } from "../../src/guard/index.js";

type Post = { id: string; authorId: string; views: number };

const failing = (
	issues: {
		message: string;
		path?: readonly (PropertyKey | { key: PropertyKey })[];
	}[],
): StandardSchema<Record<string, unknown>> => ({
	"~standard": {
		version: 1,
		vendor: "probe",
		validate: () => ({ issues }),
	},
});

describe("what a schema refusal says", () => {
	it("keeps the path the schema blamed", () => {
		const ac = defineAbilities({
			resources: {
				post: {
					schema: failing([
						{ message: "expected string", path: ["authorId"] },
						{ message: "too small", path: ["meta", "views"] },
					]),
					actions: ["read"],
				},
			},
		});

		expect(buildAbility(ac, []).validate("post", {})).toEqual({
			ok: false,
			issues: [
				{ message: "expected string", path: ["authorId"] },
				{ message: "too small", path: ["meta", "views"] },
			],
		});
	});

	it("reads a path written as segment objects, the way the standard allows", () => {
		const ac = defineAbilities({
			resources: {
				post: {
					schema: failing([
						{ message: "expected string", path: [{ key: "authorId" }] },
						{ message: "out of range", path: [{ key: "tags" }, { key: 0 }] },
					]),
					actions: ["read"],
				},
			},
		});

		expect(buildAbility(ac, []).validate("post", {})).toEqual({
			ok: false,
			issues: [
				{ message: "expected string", path: ["authorId"] },
				{ message: "out of range", path: ["tags", 0] },
			],
		});
	});

	it("leaves the path out when the schema blamed the value as a whole", () => {
		const ac = defineAbilities({
			resources: {
				post: {
					schema: failing([{ message: "not an object" }]),
					actions: ["read"],
				},
			},
		});

		const result = buildAbility(ac, []).validate("post", {});

		expect(result).toEqual({
			ok: false,
			issues: [{ message: "not an object" }],
		});
		expect(result.ok === false && "path" in (result.issues[0] ?? {})).toBe(
			false,
		);
	});

	it("still names no path for a resource declared with shape alone", () => {
		const ac = defineAbilities({
			resources: { post: { schema: shape<Post>(), actions: ["read"] } },
		});

		expect(buildAbility(ac, []).validate("post", "nope")).toEqual({
			ok: false,
			issues: [{ message: "expected an object" }],
		});
	});

	it("survives a schema whose path segments are garbage", () => {
		const ac = defineAbilities({
			resources: {
				post: {
					schema: failing([
						{
							message: "broken",
							path: [null as unknown as PropertyKey, "ok"],
						},
					]),
					actions: ["read"],
				},
			},
		});

		expect(buildAbility(ac, []).validate("post", {})).toEqual({
			ok: false,
			issues: [{ message: "broken", path: [null, "ok"] }],
		});
	});
});

describe("what the guard reports when the refusal never reached the rules", () => {
	const ac = defineAbilities({
		resources: { post: { schema: shape<Post>(), actions: ["read", "update"] } },
	});
	const { allow } = createRules(ac);
	const actor = { id: "u1" };
	const row: Post = { id: "p1", authorId: "u1", views: 1 };

	it("names the missing row instead of pretending a rule decided", async () => {
		const seen: Decision[] = [];
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
			onDecision: (decision) => seen.push(decision),
		});

		const read = withPermission(
			{ action: "read", resource: "post", load: () => undefined },
			async () => "ran",
		);

		await expect(read()).rejects.toBeInstanceOf(ForbiddenError);
		expect(seen).toEqual([
			{ action: "read", resource: "post", allowed: false, reason: "no row" },
		]);
	});

	it("carries the actor with it", async () => {
		const seen: { decision: Decision; actor: { id: string } }[] = [];
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
			onDecision: (decision, who) => seen.push({ decision, actor: who }),
		});

		const read = withPermission(
			{ action: "read", resource: "post", load: () => null },
			async () => "ran",
		);

		await expect(read()).rejects.toBeInstanceOf(ForbiddenError);
		expect(seen[0]?.actor).toEqual(actor);
	});

	it("takes a loader that may find nothing, and hands the handler a row", async () => {
		const find = (id: string): Post | undefined =>
			id === "p1" ? row : undefined;

		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
		});

		const read = withPermission(
			{ action: "read", resource: "post", load: (id: string) => find(id) },
			async (ctx) => {
				expectTypeOf(ctx.row).toEqualTypeOf<Post>();
				return ctx.row.id;
			},
		);

		expect(await read("p1")).toBe("p1");
		await expect(read("p2")).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("reports nothing extra when the row is there", async () => {
		const seen: Decision[] = [];
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
			onDecision: (decision) => seen.push(decision),
		});

		const read = withPermission(
			{ action: "read", resource: "post", load: () => row },
			async () => "ran",
		);

		expect(await read()).toBe("ran");
		expect(seen).toHaveLength(1);
		expect(seen[0]?.reason).toBeUndefined();
		expect(seen[0]?.allowed).toBe(true);
	});

	it("tells the unauthenticated hook what was attempted", async () => {
		const attempts: { action: string; resource: string }[] = [];
		const withPermission = createGuard({
			ac,
			getActor: () => null,
			policy: () => [allow("read", "post")],
			onUnauthenticated: (attempt): never => {
				attempts.push(attempt);
				throw new Error("401");
			},
		});

		const update = withPermission(
			{ action: "update", resource: "post" },
			async () => "ran",
		);

		await expect(update()).rejects.toThrow("401");
		expect(attempts).toEqual([{ action: "update", resource: "post" }]);
	});

	it("leaves the decision hook silent when there is no actor to decide for", async () => {
		const onDecision = vi.fn();
		const withPermission = createGuard({
			ac,
			getActor: () => null,
			policy: () => [allow("read", "post")],
			onDecision,
		});

		const read = withPermission(
			{ action: "read", resource: "post" },
			async () => "ran",
		);

		await expect(read()).rejects.toBeInstanceOf(ForbiddenError);
		expect(onDecision).not.toHaveBeenCalled();
	});
});
