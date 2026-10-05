import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ActionOptions,
	createGuard,
	type GuardConfig,
	type GuardContext,
	type WithPermission,
} from "../../src/guard/index.js";
import {
	type Ability,
	type AbilityOptions,
	type ActionFor,
	buildAbility,
	type CheckedRule,
	type CheckedRules,
	type ConditionNode,
	ConditionOperator,
	createRules,
	type Decision,
	defineAbilities,
	ForbiddenError,
	type LoadedRelations,
	MatchQuantifier,
	markLoaded,
	type PayloadResult,
	type PayloadViolation,
	parseRules,
	RelationKind,
	RelationNotLoadedError,
	type ResourceMap,
	type ResourceName,
	RuleEffect,
	type RuleParseResult,
	type Schema,
	type SchemaIssue,
	type ShapeOf,
	shape,
	type ValidateResult,
} from "../../src/index.js";

type Post = {
	id: string;
	authorId: string;
	status: "draft" | "published";
	views: number;
};

type User = { id: string; role: string };

const ac = defineAbilities({
	resources: {
		post: { schema: shape<Post>(), actions: ["read", "update"] },
		user: { schema: shape<User>(), actions: ["read"] },
	},
});

type AC = typeof ac;
type Actor = { id: string };

const post: Post = {
	id: "p1",
	authorId: "u1",
	status: "draft",
	views: 1,
};

const ability = buildAbility(ac, []);

describe("the entry point's surface", () => {
	it("exports every runtime name the package documents", async () => {
		const core: Record<string, unknown> = await import("../../src/index.js");
		const guard: Record<string, unknown> = await import(
			"../../src/guard/index.js"
		);

		expect(Object.keys(core).sort()).toEqual([
			"ConditionOperator",
			"ForbiddenError",
			"MatchQuantifier",
			"RelationKind",
			"RelationNotLoadedError",
			"RuleEffect",
			"buildAbility",
			"createRules",
			"defineAbilities",
			"markLoaded",
			"parseRules",
			"shape",
			"withEnv",
		]);
		expect(Object.keys(guard)).toEqual(["createGuard"]);
	});

	it("names the operators, effects, kinds and quantifiers a rule can carry", () => {
		expectTypeOf<ConditionOperator>().toEqualTypeOf<
			| "eq"
			| "ne"
			| "in"
			| "nin"
			| "gt"
			| "gte"
			| "lt"
			| "lte"
			| "contains"
			| "exists"
			| "has"
			| "hasAny"
			| "hasAll"
		>();
		expectTypeOf<MatchQuantifier>().toEqualTypeOf<"some" | "every" | "none">();
		expectTypeOf<RelationKind>().toEqualTypeOf<"one" | "many">();
		expectTypeOf<RuleEffect>().toEqualTypeOf<"allow" | "deny">();

		expect(Object.values(ConditionOperator)).toContain("hasAll");
		expect(Object.values(MatchQuantifier)).toEqual(["some", "every", "none"]);
		expect(Object.values(RelationKind)).toEqual(["one", "many"]);
		expect(Object.values(RuleEffect)).toEqual(["allow", "deny"]);
	});
});

describe("buildAbility hands back an ability bound to the declarations", () => {
	it("is an Ability over the registry it was given", () => {
		expectTypeOf(buildAbility).parameter(0).toExtend<ResourceMap>();
		expectTypeOf(buildAbility)
			.parameter(1)
			.toEqualTypeOf<readonly CheckedRule[]>();
		expectTypeOf(buildAbility)
			.parameter(2)
			.toEqualTypeOf<AbilityOptions | undefined>();
		expectTypeOf(ability).toEqualTypeOf<Ability<AC>>();
		expectTypeOf(ability.rules).toEqualTypeOf<readonly CheckedRule[]>();
	});

	it("answers a boolean for the deciding calls and nothing for authorize", () => {
		expectTypeOf(ability.can("read", "post", post)).toEqualTypeOf<boolean>();
		expectTypeOf(ability.cannot("read", "post", post)).toEqualTypeOf<boolean>();
		expectTypeOf(ability.authorize).returns.toEqualTypeOf<void>();
		expectTypeOf(
			ability.canMutate("update", "post", post),
		).toEqualTypeOf<boolean>();
	});

	it("takes the row the resource declares, and no other", () => {
		// @ts-expect-error a user is not a post
		ability.can("read", "post", { id: "u1", role: "admin" });
		// @ts-expect-error the action must be one the resource declares
		ability.can("archive", "post");
		// @ts-expect-error the resource must be declared
		ability.can("read", "comment");
		// @ts-expect-error canMutate takes a partial row, not a payload of foreign keys
		ability.canMutate("update", "post", { nope: 1 });
	});

	it("keeps the field list a caller passes, narrowed to what it named", () => {
		expectTypeOf(
			ability.permittedFields("update", "post", undefined, ["status", "views"]),
		).toEqualTypeOf<("status" | "views")[]>();
		// @ts-expect-error the field must belong to the resource
		ability.permittedFields("update", "post", undefined, ["nope"]);
	});

	it("answers where() with a condition over the resource shape", () => {
		expectTypeOf(ability.where("read", "post")).toEqualTypeOf<
			ConditionNode<Post>
		>();
	});

	it("answers validate() and validatePayload() over the resource shape", () => {
		expectTypeOf(ability.validate("post", {} as unknown)).toEqualTypeOf<
			ValidateResult<Post>
		>();
		expectTypeOf(
			ability.validatePayload("update", "post", post, { status: "published" }),
		).toEqualTypeOf<PayloadResult<Post>>();
		expectTypeOf(
			ability.validatePayload("update", "post", undefined, { views: 2 }),
		).toEqualTypeOf<PayloadResult<Post>>();
		// @ts-expect-error the row comes before the data, and a payload is not a row
		ability.validatePayload("update", "post", { status: "published" }, post);
	});
});

describe("the results a caller narrows", () => {
	it("gives validatePayload a validated copy or the fields it refused", () => {
		expectTypeOf<
			Extract<PayloadResult<Post>, { ok: true }>["data"]
		>().toEqualTypeOf<Partial<Post>>();
		expectTypeOf<
			Extract<PayloadResult<Post>, { ok: false }>["violations"]
		>().toEqualTypeOf<PayloadViolation[]>();
		expectTypeOf<PayloadViolation>().toEqualTypeOf<{
			field: string;
			reason: string;
		}>();
	});

	it("gives validate the typed value or the issues the schema raised", () => {
		expectTypeOf<
			Extract<ValidateResult<Post>, { ok: true }>["value"]
		>().toEqualTypeOf<Post>();
		expectTypeOf<
			Extract<ValidateResult<Post>, { ok: false }>["issues"]
		>().toEqualTypeOf<SchemaIssue[]>();
		expectTypeOf<SchemaIssue["path"]>().toEqualTypeOf<
			PropertyKey[] | undefined
		>();
	});

	it("gives parseRules the checked rules or the paths that failed", () => {
		expectTypeOf(parseRules([])).toEqualTypeOf<RuleParseResult<CheckedRules>>();
		expectTypeOf<
			Extract<RuleParseResult<CheckedRules>, { ok: true }>["rules"]
		>().toEqualTypeOf<CheckedRules>();
		expectTypeOf<
			Extract<RuleParseResult, { ok: false }>["errors"]
		>().toEqualTypeOf<string[]>();
	});

	it("reports a decision without the row or the data", () => {
		expectTypeOf<NonNullable<AbilityOptions["onDecision"]>>().toEqualTypeOf<
			(decision: Decision) => void
		>();
		expectTypeOf<Decision["allowed"]>().toEqualTypeOf<boolean>();
		expectTypeOf<Decision["violations"]>().toEqualTypeOf<
			PayloadViolation[] | undefined
		>();
		expectTypeOf<Decision["reason"]>().toEqualTypeOf<
			"no row" | "not a plain row" | undefined
		>();
	});
});

describe("the rest of the runtime exports", () => {
	it("writes a checked rule from either effect", () => {
		const { allow, deny } = createRules(ac);

		expectTypeOf(allow("update", "post")).toEqualTypeOf<CheckedRule>();
		expectTypeOf(deny("update", "post")).toEqualTypeOf<CheckedRule>();
		expectTypeOf<CheckedRules>().toEqualTypeOf<CheckedRule[]>();
		expect(allow("update", "post").effect).toBe("allow");
	});

	it("declares a shape that carries the row type and nothing else", () => {
		expectTypeOf(shape<Post>()).toEqualTypeOf<Schema<Post>>();
		expectTypeOf<ShapeOf<AC, "post">>().toEqualTypeOf<Post>();
		expectTypeOf<ResourceName<AC>>().toEqualTypeOf<"post" | "user">();
		expectTypeOf<ActionFor<AC, "post">>().toEqualTypeOf<
			"read" | "update" | "manage"
		>();
	});

	it("hands markLoaded back the row type it was given", () => {
		expectTypeOf(markLoaded(post, "author", null)).toEqualTypeOf<Post>();
		expect(markLoaded(post, "author", null)).not.toBe(post);
	});

	it("checks the relations markLoaded is told about against the row type", () => {
		type Comment = { id: string; author?: User | null };
		type Article = {
			id: string;
			title: string;
			author?: User | null;
			comments?: Comment[];
		};
		const article: Article = { id: "a1", title: "t" };
		const loaded = {
			author: null,
			comments: [{ author: null }],
		} satisfies LoadedRelations<Article>;

		expectTypeOf(markLoaded(article, loaded)).toEqualTypeOf<Article>();
		// @ts-expect-error a to-one relation is not emptied as a list
		markLoaded(article, { author: [] });
		// @ts-expect-error a list its type keeps from null is not emptied as null
		markLoaded(article, { comments: null });
		// @ts-expect-error a field is not a relation
		markLoaded(article, { title: null });
		// @ts-expect-error a relation the row does not have
		markLoaded(article, { autor: null });
	});

	it("brands its refusals so a second copy of the package still answers", () => {
		expectTypeOf(ForbiddenError.is).guards.toEqualTypeOf<ForbiddenError>();
		expectTypeOf<ForbiddenError["action"]>().toEqualTypeOf<string>();
		expectTypeOf<ForbiddenError["resource"]>().toEqualTypeOf<string>();
		expectTypeOf<ForbiddenError["violations"]>().toEqualTypeOf<
			PayloadViolation[] | undefined
		>();
		expect(ForbiddenError.is(new ForbiddenError("update", "post"))).toBe(true);
		expect(new RelationNotLoadedError("author")).toBeInstanceOf(Error);
	});
});

describe("the guard's types", () => {
	const guard = createGuard({
		ac,
		getActor: (): Actor => ({ id: "u1" }),
		policy: () => [],
	});

	it("is a WithPermission over the registry and the actor", () => {
		expectTypeOf(guard).toEqualTypeOf<WithPermission<AC, Actor>>();
		expectTypeOf<GuardConfig<AC, Actor>["policy"]>().toEqualTypeOf<
			(actor: Actor) => CheckedRules
		>();
	});

	it("keeps the handler's own arguments and result", () => {
		const wrapped = guard(
			{ action: "read", resource: "post" },
			async (_ctx, id: string) => id.length,
		);

		expectTypeOf(wrapped).toEqualTypeOf<(id: string) => Promise<number>>();
	});

	it("hands the handler a row only when the action declares how to load one", () => {
		type Loaded = GuardContext<
			AC,
			"post",
			Actor,
			{ action: "update"; resource: "post"; load: () => Promise<Post> }
		>;
		type Bare = GuardContext<AC, "post", Actor>;

		expectTypeOf<Loaded["row"]>().toEqualTypeOf<Post>();
		expectTypeOf<Loaded["actor"]>().toEqualTypeOf<Actor>();
		expectTypeOf<Loaded["ability"]>().toEqualTypeOf<Ability<AC>>();
		expectTypeOf<Bare["row"]>().toEqualTypeOf<Post | undefined>();
	});

	it("hands the handler a payload only when the action declares how to read one", () => {
		type Written = GuardContext<
			AC,
			"post",
			Actor,
			{ action: "update"; resource: "post"; payload: () => Partial<Post> }
		>;
		type Bare = GuardContext<AC, "post", Actor>;

		expectTypeOf<Written["payload"]>().toEqualTypeOf<Partial<Post>>();
		expectTypeOf<Bare["payload"]>().toEqualTypeOf<Partial<Post> | undefined>();
	});

	it("binds load and payload to the resource the action names", () => {
		expectTypeOf<
			NonNullable<ActionOptions<AC, "post", [string]>["load"]>
		>().toEqualTypeOf<
			(id: string) => Post | null | undefined | Promise<Post | null | undefined>
		>();
		expectTypeOf<
			NonNullable<ActionOptions<AC, "post", [string]>["payload"]>
		>().toEqualTypeOf<(id: string) => Partial<Post>>();
	});
});
