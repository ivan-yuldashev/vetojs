import { describe, expect, expectTypeOf, it } from "vitest";
import type { AbilitySet } from "../../src/api/ability.types.js";
import { createRules } from "../../src/api/create-rules.js";
import { defineAbilities } from "../../src/api/define-abilities.js";
import { shape } from "../../src/api/schema.js";
import { ForbiddenError } from "../../src/errors/index.js";
import { createGuard } from "../../src/guard/index.js";

type Post = {
	id: string;
	authorId: string;
	status: "draft" | "published";
};

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read", "update"],
		},
	},
});

const { allow, deny } = createRules(ac);
const actor = { id: "u1" };

describe("createGuard", () => {
	it("runs the handler when a blanket read is allowed", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
		});
		const getPost = withPermission(
			{ action: "read", resource: "post" },
			async (ctx, id: string) => ({ id, by: ctx.actor.id }),
		);
		expect(await getPost("p1")).toEqual({ id: "p1", by: "u1" });
	});

	it("throws ForbiddenError when access is denied", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [],
		});
		const getPost = withPermission(
			{ action: "read", resource: "post" },
			async () => "ok",
		);
		await expect(getPost()).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("checks the instance against the rule's where", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("read", "post", { where: { authorId: { eq: "u1" } } }),
			],
		});
		const getOwn = withPermission(
			{
				action: "read",
				resource: "post",
				load: (row: Post) => row,
			},
			async (ctx) => ctx.row?.id,
		);
		expect(await getOwn({ id: "p1", authorId: "u1", status: "draft" })).toBe(
			"p1",
		);
		await expect(
			getOwn({ id: "p2", authorId: "u2", status: "draft" }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("denies when load resolves to no row instead of falling back to the row-less check", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("read", "post", { where: { authorId: { eq: "u1" } } }),
			],
		});
		const getMissing = withPermission(
			{
				action: "read",
				resource: "post",
				load: () => undefined as unknown as Post,
			},
			async (ctx) => ctx.row?.id,
		);

		await expect(getMissing()).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("denies when load resolves to something that is not a row", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
		});

		for (const value of ["p1", 42, null, [{ id: "p1" }]]) {
			const getOdd = withPermission(
				{
					action: "read",
					resource: "post",
					load: () => value as unknown as Post,
				},
				async (ctx) => ctx.row?.id,
			);

			await expect(getOdd()).rejects.toBeInstanceOf(ForbiddenError);
		}
	});

	it("lets a payload-scoped deny through the row-less path and settles it on the payload", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
				deny("update", "post", { payload: { fields: ["authorId"] } }),
			],
		});
		const updateNoLoad = withPermission(
			{
				action: "update",
				resource: "post",
				payload: (input: { data: Partial<Post> }) => input.data,
			},
			async (ctx) => ctx.payload,
		);

		expect(await updateNoLoad({ data: { status: "draft" } })).toEqual({
			status: "draft",
		});
		await expect(
			updateNoLoad({ data: { authorId: "u2" } }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("validates the payload and exposes it on ctx", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
			],
		});
		const updatePost = withPermission(
			{
				action: "update",
				resource: "post",
				load: (input: { id: string; data: Partial<Post> }) => ({
					id: input.id,
					authorId: "u1",
					status: "draft" as const,
				}),
				payload: (input) => input.data,
			},
			async (ctx) => ctx.payload,
		);
		expect(
			await updatePost({ id: "p1", data: { status: "published" } }),
		).toEqual({ status: "published" });
	});

	it("denies a payload touching a non-permitted field", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
			],
		});
		const updatePost = withPermission(
			{
				action: "update",
				resource: "post",
				load: (input: { id: string; data: Partial<Post> }) => ({
					id: input.id,
					authorId: "u1",
					status: "draft" as const,
				}),
				payload: (input) => input.data,
			},
			async (ctx) => ctx.payload,
		);
		await expect(
			updatePost({ id: "p1", data: { authorId: "hacked" } }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("fails closed on a payload mutation without load when a conditional deny matches", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
				deny("update", "post", { where: { status: { eq: "published" } } }),
			],
		});
		const updateNoLoad = withPermission(
			{
				action: "update",
				resource: "post",
				payload: (input: { data: Partial<Post> }) => input.data,
			},
			async (ctx) => ctx.payload,
		);
		await expect(
			updateNoLoad({ data: { status: "draft" } }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("allows a payload mutation without load when no conditional deny matches", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
			],
		});
		const createStyle = withPermission(
			{
				action: "update",
				resource: "post",
				payload: (input: { data: Partial<Post> }) => input.data,
			},
			async (ctx) => ctx.payload,
		);
		expect(await createStyle({ data: { status: "draft" } })).toEqual({
			status: "draft",
		});
	});

	it("exposes the validated copy on ctx.payload, not the raw input", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
			],
		});
		const updatePost = withPermission(
			{
				action: "update",
				resource: "post",
				load: (input: { id: string; data: Partial<Post> }) => ({
					id: input.id,
					authorId: "u1",
					status: "draft" as const,
				}),
				payload: (input) => input.data,
			},
			async (ctx) => ctx.payload,
		);
		const data: Partial<Post> = { status: "published" };
		const result = await updatePost({ id: "p1", data });
		expect(result).toEqual(data);
		expect(result).not.toBe(data);
	});

	it("fails closed on a no-load mutation when an unconditional deny matches", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
				deny("update", "post"),
			],
		});
		const updateNoLoad = withPermission(
			{
				action: "update",
				resource: "post",
				payload: (input: { data: Partial<Post> }) => input.data,
			},
			async (ctx) => ctx.payload,
		);
		await expect(
			updateNoLoad({ data: { status: "published" } }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("denies a no-load mutation when the policy grants nothing", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [],
		});
		const updateNoLoad = withPermission(
			{
				action: "update",
				resource: "post",
				payload: (input: { data: Partial<Post> }) => input.data,
			},
			async (ctx) => ctx.payload,
		);

		await expect(updateNoLoad({ data: {} })).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(
			updateNoLoad({ data: { status: "draft" } }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("passes multiple action arguments through to load, payload and handler", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
			],
		});
		const updatePost = withPermission(
			{
				action: "update",
				resource: "post",
				load: (id: string, _data: Partial<Post>) => ({
					id,
					authorId: "u1",
					status: "draft" as const,
				}),
				payload: (_id, data) => data,
			},
			async (ctx, id, _data) => ({ id, status: ctx.payload?.status }),
		);
		expect(await updatePost("p1", { status: "published" })).toEqual({
			id: "p1",
			status: "published",
		});
	});

	it("denies a row whose field arrives type-confused, on both polarities", async () => {
		const denies = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("read", "post"),
				deny("read", "post", { where: { status: { eq: "draft" } } }),
			],
		});
		const allows = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("read", "post", { where: { status: { eq: "draft" } } }),
			],
		});

		const confused = [
			{ id: "p1", authorId: "u1", status: ["draft"] },
			{ id: "p1", authorId: "u1", status: { value: "draft" } },
		];

		for (const row of confused) {
			const underDeny = denies(
				{ action: "read", resource: "post", load: () => row as never },
				async (ctx) => ctx.row?.id,
			);
			const underAllow = allows(
				{ action: "read", resource: "post", load: () => row as never },
				async (ctx) => ctx.row?.id,
			);

			await expect(underDeny()).rejects.toBeInstanceOf(ForbiddenError);
			await expect(underAllow()).rejects.toBeInstanceOf(ForbiddenError);
		}
	});

	it("denies a payload that is not an object", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { payload: { fields: ["status"] } }),
			],
		});

		for (const payload of ["status=draft", 42, [{ status: "draft" }], true]) {
			const update = withPermission(
				{
					action: "update",
					resource: "post",
					load: () => ({ id: "p1", authorId: "u1", status: "draft" }) as Post,
					payload: () => payload as never,
				},
				async (ctx) => ctx.payload,
			);

			await expect(update()).rejects.toBeInstanceOf(ForbiddenError);
		}
	});

	it("denies a payload value that a constraint cannot decide", async () => {
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", {
					payload: {
						fields: ["status"],
						constraints: { status: { eq: "draft" } },
					},
				}),
			],
		});

		const update = (status: unknown) =>
			withPermission(
				{
					action: "update",
					resource: "post",
					load: () => ({ id: "p1", authorId: "u1", status: "draft" }) as Post,
					payload: () => ({ status }) as never,
				},
				async (ctx) => ctx.payload,
			)();

		expect(await update("draft")).toEqual({ status: "draft" });
		await expect(update(["draft"])).rejects.toBeInstanceOf(ForbiddenError);
		await expect(update({ value: "draft" })).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});

	it("routes denials through a custom onDeny", async () => {
		const seen: ForbiddenError[] = [];
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [],
			onDeny: (error) => {
				seen.push(error);
				throw error;
			},
		});
		const getPost = withPermission(
			{ action: "read", resource: "post" },
			async () => "ok",
		);
		await expect(getPost()).rejects.toBeInstanceOf(ForbiddenError);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.action).toBe("read");
	});

	it("still denies when onDeny returns instead of throwing", async () => {
		const seen: ForbiddenError[] = [];
		const withPermission = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [],
			onDeny: ((error: ForbiddenError) => {
				seen.push(error);
			}) as (error: ForbiddenError) => never,
		});
		const getPost = withPermission(
			{ action: "read", resource: "post" },
			async () => "ok",
		);

		await expect(getPost()).rejects.toBeInstanceOf(ForbiddenError);
		expect(seen).toHaveLength(1);
	});
});

describe("no actor signed in", () => {
	it("routes through onUnauthenticated when provided", async () => {
		const seen: string[] = [];
		const guard = createGuard({
			ac,
			getActor: () => null,
			policy: () => [],
			onUnauthenticated: () => {
				seen.push("401");
				throw new Error("unauthenticated");
			},
		});
		const action = guard(
			{ action: "read", resource: "post" },
			async () => "ok",
		);

		await expect(action()).rejects.toThrow("unauthenticated");
		expect(seen).toEqual(["401"]);
	});

	it("still denies when onUnauthenticated returns instead of throwing", async () => {
		const seen: string[] = [];
		const guard = createGuard({
			ac,
			getActor: () => null,
			policy: () => [],
			onUnauthenticated: (() => {
				seen.push("401");
			}) as () => never,
		});
		const action = guard(
			{ action: "read", resource: "post" },
			async () => "ok",
		);

		await expect(action()).rejects.toBeInstanceOf(ForbiddenError);
		expect(seen).toEqual(["401"]);
	});

	it("falls back to a plain denial without the hook", async () => {
		const guard = createGuard({ ac, getActor: () => null, policy: () => [] });
		const action = guard(
			{ action: "read", resource: "post" },
			async () => "ok",
		);

		await expect(action()).rejects.toThrow(ForbiddenError);
	});
});

describe("one actor's decision never reaches another", () => {
	const guardFor = (actors: { id: string }[]) => {
		let call = 0;

		return createGuard({
			ac,
			getActor: () => actors[call++] ?? null,
			policy: (current: { id: string }) => [
				allow("update", "post", { where: { authorId: current.id } }),
			],
		});
	};

	it("rebuilds the policy per call rather than reusing the first actor's", async () => {
		const guard = guardFor([{ id: "u1" }, { id: "u2" }]);
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => ({
					id: "p1",
					authorId: "u1",
					status: "draft" as const,
				}),
			},
			async (ctx) => ctx.actor.id,
		);

		await expect(action()).resolves.toBe("u1");
		await expect(action()).rejects.toThrow(ForbiddenError);
	});

	it("hands the handler the actor of its own call", async () => {
		const guard = guardFor([{ id: "u2" }, { id: "u1" }]);
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => ({
					id: "p1",
					authorId: "u2",
					status: "draft" as const,
				}),
			},
			async (ctx) => ctx.actor.id,
		);

		await expect(action()).resolves.toBe("u2");
		await expect(action()).rejects.toThrow(ForbiddenError);
	});
});

describe("attempts to smuggle data past the gate", () => {
	const guard = createGuard({
		ac,
		getActor: () => actor,
		policy: () => [
			allow("update", "post", {
				where: { authorId: "u1" },
				payload: { fields: ["status"] },
			}),
		],
	});

	const row = { id: "p1", authorId: "u1", status: "draft" as const };

	it("refuses a payload carrying __proto__ and leaves Object.prototype alone", async () => {
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => row,
				payload: () =>
					JSON.parse('{"status":"draft","__proto__":{"polluted":true}}'),
			},
			async (ctx) => ctx.payload,
		);

		await expect(action()).rejects.toThrow(ForbiddenError);
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});

	it("ignores a field mutated after the payload was validated", async () => {
		const draft: Record<string, unknown> = { status: "draft" };
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => row,
				payload: () => draft,
			},
			async (ctx) => {
				draft.status = "published";

				return ctx.payload;
			},
		);

		await expect(action()).resolves.toEqual({ status: "draft" });
	});

	it("does not let a deny on another action decide this one", async () => {
		const permissive = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [
				allow("update", "post", { where: { authorId: "u1" } }),
				deny("read", "post"),
			],
		});
		const action = permissive(
			{ action: "update", resource: "post", load: async () => row },
			async () => "ok",
		);

		await expect(action()).resolves.toBe("ok");
	});
});

describe("failures that are not denials", () => {
	const guard = createGuard({
		ac,
		getActor: () => actor,
		policy: () => [allow("update", "post")],
	});

	it("lets an error from load through instead of turning it into a denial", async () => {
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => {
					throw new Error("database is down");
				},
			},
			async () => "ok",
		);

		await expect(action()).rejects.toThrow("database is down");
	});

	it("lets an error from getActor through", async () => {
		const failing = createGuard({
			ac,
			getActor: async () => {
				throw new Error("session store unreachable");
			},
			policy: () => [],
		});
		const action = failing(
			{ action: "read", resource: "post" },
			async () => "ok",
		);

		await expect(action()).rejects.toThrow("session store unreachable");
	});

	it("lets an error from the handler through untouched", async () => {
		const action = guard({ action: "update", resource: "post" }, async () => {
			throw new Error("write failed");
		});

		await expect(action()).rejects.toThrow("write failed");
	});
});

describe("shape validation is the caller's, and its errors stay its own", () => {
	const guard = createGuard({
		ac,
		getActor: () => actor,
		policy: () => [
			allow("update", "post", { payload: { fields: ["status"] } }),
		],
	});
	const row = { id: "p1", authorId: "u1", status: "draft" as const };

	it("does not run the resource's schema — permissions are a different question", async () => {
		// The value arrives past the types, the way JSON or a tool call does.
		const fromTheWire = JSON.parse(
			'{"status":"neither draft nor published"}',
		) as {
			status: Post["status"];
		};
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => row,
				payload: () => fromTheWire,
			},
			async (ctx) => ctx.payload,
		);

		await expect(action()).resolves.toEqual({
			status: "neither draft nor published",
		});
	});

	it("lets a rejection from payload through as itself, not as a denial", async () => {
		const action = guard(
			{
				action: "update",
				resource: "post",
				load: async () => row,
				payload: () => {
					throw new TypeError("status must be draft or published");
				},
			},
			async (ctx) => ctx.payload,
		);

		await expect(action()).rejects.toBeInstanceOf(TypeError);
		await expect(action()).rejects.not.toBeInstanceOf(ForbiddenError);
	});
});

describe("the context says exactly what the options loaded", () => {
	const guard = createGuard({
		ac,
		getActor: () => actor,
		policy: () => [allow("update", "post"), allow("read", "post")],
	});
	const row: Post = { id: "p1", authorId: "u1", status: "draft" };

	it("gives the handler a row when load is there and nothing when it is not", async () => {
		const loaded = guard(
			{ action: "read", resource: "post", load: async () => row },
			async (ctx) => {
				expectTypeOf(ctx.row).toEqualTypeOf<Post>();

				return ctx.row.id;
			},
		);
		const blanket = guard({ action: "read", resource: "post" }, async (ctx) => {
			expectTypeOf(ctx.row).toEqualTypeOf<Post | undefined>();

			return ctx.row;
		});

		await expect(loaded()).resolves.toBe("p1");
		await expect(blanket()).resolves.toBeUndefined();
	});

	it("gives the handler a payload when payload is there and nothing when it is not", async () => {
		const writing = guard(
			{
				action: "update",
				resource: "post",
				load: async () => row,
				payload: (): Partial<Post> => ({ status: "published" }),
			},
			async (ctx) => {
				expectTypeOf(ctx.payload).toEqualTypeOf<Partial<Post>>();

				return ctx.payload.status;
			},
		);
		const reading = guard(
			{ action: "read", resource: "post", load: async () => row },
			async (ctx) => {
				expectTypeOf(ctx.payload).toEqualTypeOf<Partial<Post> | undefined>();

				return ctx.payload;
			},
		);

		await expect(writing()).resolves.toBe("published");
		await expect(reading()).resolves.toBeUndefined();
	});
});

describe("the options are checked against the declarations", () => {
	const guard = createGuard({
		ac,
		getActor: () => actor,
		policy: () => [allow("read", "post")],
	});
	const row: Post = { id: "p1", authorId: "u1", status: "draft" };

	it("refuses an action the resource does not declare", () => {
		guard(
			// @ts-expect-error "archive" is not one of post's actions
			{ action: "archive", resource: "post" },
			async () => "ok",
		);
	});

	it("refuses a resource that is not declared", () => {
		guard(
			// @ts-expect-error "comment" is not a resource here
			{ action: "read", resource: "comment" },
			async () => "ok",
		);
	});

	it("refuses a load that resolves to another shape", () => {
		guard(
			{
				action: "read",
				resource: "post",
				// @ts-expect-error the loaded value is not a post
				load: async () => ({ id: "p1", title: "not a post" }),
			},
			async () => "ok",
		);
	});

	it("refuses a payload field the resource does not have", () => {
		guard(
			{
				action: "read",
				resource: "post",
				load: async () => row,
				// @ts-expect-error "nope" is not a field of post
				payload: () => ({ nope: 1 }),
			},
			async (ctx) => ctx.payload,
		);
	});
});

describe("the guard reports the decisions it makes", () => {
	const row: Post = { id: "p1", authorId: "u1", status: "draft" };

	it("hands each decision to the hook, with the actor in scope", async () => {
		const seen: { actor: string; allowed: boolean; rule: boolean }[] = [];
		const guard = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [allow("read", "post")],
			onDecision: (decision, who) =>
				seen.push({
					actor: who.id,
					allowed: decision.allowed,
					rule: decision.rule !== undefined,
				}),
		});
		const read = guard(
			{ action: "read", resource: "post", load: async () => row },
			async (ctx) => ctx.row.id,
		);

		await expect(read()).resolves.toBe("p1");
		expect(seen).toEqual([{ actor: "u1", allowed: true, rule: true }]);
	});

	it("reports the refusal that becomes a ForbiddenError", async () => {
		const seen: boolean[] = [];
		const guard = createGuard({
			ac,
			getActor: () => actor,
			policy: () => [],
			onDecision: (decision) => seen.push(decision.allowed),
		});
		const read = guard(
			{ action: "read", resource: "post", load: async () => row },
			async () => "ok",
		);

		await expect(read()).rejects.toBeInstanceOf(ForbiddenError);
		expect(seen).toEqual([false]);
	});

	it("reads the same list can() reads, whatever happens to the caller's array", async () => {
		const policy = [allow("read", "post")];
		const built: AbilitySet[] = [];

		const guard = createGuard({
			ac,
			getActor: () => actor,
			policy: () => policy,
			onDecision: () => undefined,
		});

		const read = guard({ action: "read", resource: "post" }, async (ctx) => {
			built.push((ctx as { ability: AbilitySet }).ability);

			return "ok";
		});

		await expect(read()).resolves.toBe("ok");

		policy.push(deny("read", "post"));

		const ability = built[0];

		expect(ability).toBeDefined();

		if (ability === undefined) {
			return;
		}

		expect(ability.rules).toHaveLength(1);
		expect(ability.can("read", "post")).toBe(true);
		await expect(read()).rejects.toBeInstanceOf(ForbiddenError);
	});
});
