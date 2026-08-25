import { describe, expect, it } from "vitest";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import { evaluateCondition } from "../../src/evaluation/condition.js";
import { markLoaded } from "../../src/evaluation/loaded.js";
import type { ConditionNode } from "../../src/model/index.js";

type Workspace = { id: string; plan: string };
type Blog = { id: string; workspaceId: string; workspace?: Workspace | null };
type Comment = { id: string; spam: boolean; blog?: Blog | null };

type Post = {
	authorId: string;
	status: "draft" | "published";
	views: number;
	blog?: Blog | null;
	comments?: Comment[];
};

const post = (overrides?: Partial<Post>): Post => ({
	authorId: "u1",
	status: "published",
	views: 120,
	...overrides,
});

const reachesWorkspace: ConditionNode<Comment> = {
	relation: "blog",
	type: "one",
	where: {
		relation: "workspace",
		type: "one",
		where: { field: "plan", op: "eq", value: "pro" },
	},
};

describe("a condition compiled once answers exactly as the tree reads", () => {
	describe("the same node asked repeatedly", () => {
		it("answers per instance, not per first instance", () => {
			const node: ConditionNode<Post> = {
				field: "authorId",
				op: "eq",
				value: "u1",
			};

			expect(evaluateCondition(node, post())).toBe(true);
			expect(evaluateCondition(node, post({ authorId: "u2" }))).toBe(false);
			expect(evaluateCondition(node, post())).toBe(true);
		});

		it("keeps two rules sharing one node object in agreement", () => {
			const shared: ConditionNode<Post> = {
				field: "status",
				op: "eq",
				value: "published",
			};

			const wrapped: ConditionNode<Post> = { and: [shared, shared] };

			expect(evaluateCondition(shared, post())).toBe(true);
			expect(evaluateCondition(wrapped, post())).toBe(true);
			expect(evaluateCondition(shared, post({ status: "draft" }))).toBe(false);
			expect(evaluateCondition(wrapped, post({ status: "draft" }))).toBe(false);
		});

		it("does not let a node used inside a relation change how it answers alone", () => {
			const leaf: ConditionNode<Record<string, unknown>> = {
				field: "spam",
				op: "eq",
				value: false,
			};

			const inRelation: ConditionNode<Post> = {
				relation: "comments",
				type: "many",
				match: "every",
				where: leaf,
			};

			const clean = post({ comments: [{ id: "c1", spam: false }] });

			expect(evaluateCondition(inRelation, clean)).toBe(true);
			expect(evaluateCondition(leaf, { id: "c1", spam: false })).toBe(true);
			expect(evaluateCondition(leaf, { id: "c2", spam: true })).toBe(false);
			expect(evaluateCondition(inRelation, clean)).toBe(true);
		});
	});

	describe("three-valued logic survives the short circuit", () => {
		const unloaded: ConditionNode<Post> = {
			relation: "comments",
			type: "many",
			match: "some",
			where: { field: "spam", op: "eq", value: true },
		};

		it("keeps a false in an and, whatever sits beside it", () => {
			const loaded = post({ comments: [{ id: "c1", spam: true }] });

			expect(
				evaluateCondition(
					{ and: [{ field: "views", op: "eq", value: 0 }, unloaded] },
					loaded,
				),
			).toBe(false);

			expect(
				evaluateCondition(
					{ and: [unloaded, { field: "views", op: "eq", value: 0 }] },
					loaded,
				),
			).toBe(false);
		});

		it("keeps a true in an or, whatever sits beside it", () => {
			const loaded = post({ comments: [] });

			expect(
				evaluateCondition(
					{ or: [{ field: "views", op: "eq", value: 120 }, unloaded] },
					loaded,
				),
			).toBe(true);

			expect(
				evaluateCondition(
					{ or: [unloaded, { field: "views", op: "eq", value: 120 }] },
					loaded,
				),
			).toBe(true);
		});

		it("reports undefined, not false, when a branch could not be decided", () => {
			const garbled = post({
				// @ts-expect-error the relation arrived as something no ORM would return
				comments: [true],
			});

			expect(evaluateCondition(unloaded, garbled)).toBeUndefined();
			expect(
				evaluateCondition(
					{ and: [{ field: "views", op: "eq", value: 120 }, unloaded] },
					garbled,
				),
			).toBeUndefined();
			expect(
				evaluateCondition(
					{ or: [{ field: "views", op: "eq", value: 0 }, unloaded] },
					garbled,
				),
			).toBeUndefined();
			expect(evaluateCondition({ not: unloaded }, garbled)).toBeUndefined();
		});
	});

	describe("a missing include is reported wherever it sits", () => {
		const relation: ConditionNode<Post> = {
			relation: "comments",
			type: "many",
			match: "some",
			where: { field: "spam", op: "eq", value: true },
		};

		it("throws when an and beside it is already false", () => {
			expect(() =>
				evaluateCondition(
					{ and: [{ field: "views", op: "eq", value: 0 }, relation] },
					post(),
				),
			).toThrow(RelationNotLoadedError);
		});

		it("throws when an or beside it is already true", () => {
			expect(() =>
				evaluateCondition(
					{ or: [{ field: "views", op: "eq", value: 120 }, relation] },
					post(),
				),
			).toThrow(RelationNotLoadedError);
		});

		it("throws from under a not", () => {
			expect(() => evaluateCondition({ not: relation }, post())).toThrow(
				RelationNotLoadedError,
			);
		});

		it("throws for a later item after an earlier one already answered", () => {
			const settling = (plan: string): Comment => ({
				id: "c1",
				spam: false,
				blog: { id: "b1", workspaceId: "w1", workspace: { id: "w1", plan } },
			});

			const missing: Comment = {
				id: "c2",
				spam: false,
				blog: { id: "b2", workspaceId: "w2" },
			};

			const cases = [
				["some", "pro"],
				["none", "pro"],
				["every", "free"],
			] as const;

			for (const [match, plan] of cases) {
				expect(() =>
					evaluateCondition(
						{
							relation: "comments",
							type: "many",
							match,
							where: reachesWorkspace,
						},
						post({ comments: [settling(plan), missing] }),
					),
				).toThrow(RelationNotLoadedError);
			}
		});

		it("still answers those quantifiers when every item is loaded", () => {
			const loaded = (plan: string, id: string): Comment => ({
				id,
				spam: false,
				blog: { id, workspaceId: id, workspace: { id, plan } },
			});

			const comments = [loaded("pro", "c1"), loaded("free", "c2")];

			expect(
				evaluateCondition(
					{
						relation: "comments",
						type: "many",
						match: "some",
						where: reachesWorkspace,
					},
					post({ comments }),
				),
			).toBe(true);

			expect(
				evaluateCondition(
					{
						relation: "comments",
						type: "many",
						match: "every",
						where: reachesWorkspace,
					},
					post({ comments }),
				),
			).toBe(false);

			expect(
				evaluateCondition(
					{
						relation: "comments",
						type: "many",
						match: "none",
						where: reachesWorkspace,
					},
					post({ comments }),
				),
			).toBe(false);
		});

		it("stays quiet once the relation is marked loaded", () => {
			const marked = markLoaded(post(), "comments", [
				{ id: "c1", spam: true },
			] as Comment[]);

			expect(evaluateCondition(relation, marked)).toBe(true);
		});
	});

	describe("what the row may not smuggle in", () => {
		const authorId: ConditionNode<Post> = {
			field: "authorId",
			op: "eq",
			value: "u1",
		};

		it("reads own fields only, never the prototype chain", () => {
			const inherited = Object.create({ authorId: "u1" }) as Post;

			expect(evaluateCondition(authorId, inherited)).toBe(false);
		});

		it("is not fooled by a row built without a prototype", () => {
			const bare = Object.assign(Object.create(null), {
				authorId: "u1",
			}) as Post;

			expect(evaluateCondition(authorId, bare)).toBe(true);
		});

		it("treats __proto__, constructor and prototype as ordinary field names", () => {
			for (const field of ["__proto__", "constructor", "prototype"]) {
				const node = { field, op: "eq", value: "x" } as ConditionNode<Post>;

				expect(evaluateCondition(node, post())).toBe(false);
				expect(
					evaluateCondition(
						node,
						Object.assign(Object.create(null), { [field]: "x" }) as Post,
					),
				).toBe(true);
			}

			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		});

		it("denies a symbol field instead of reading one", () => {
			const node = {
				field: Symbol("authorId"),
				op: "eq",
				value: "u1",
			} as unknown as ConditionNode<Post>;

			expect(evaluateCondition(node, post())).toBe(false);
		});

		it("reads a numeric field as the string key an object actually has", () => {
			const node = { field: 0, op: "eq", value: "first" } as unknown as
				| ConditionNode<Post>
				| never;

			expect(evaluateCondition(node, { 0: "first" } as unknown as Post)).toBe(
				true,
			);
			expect(evaluateCondition(node, post())).toBe(false);
		});

		it("answers about a frozen row without touching it", () => {
			const frozen = Object.freeze(post());

			expect(evaluateCondition(authorId, frozen)).toBe(true);
			expect(Object.isFrozen(frozen)).toBe(true);
		});

		it("fails closed on a row that is not an object at all", () => {
			for (const value of [null, undefined, 7, "row", true, []]) {
				expect(evaluateCondition(authorId, value as unknown as Post)).not.toBe(
					true,
				);
			}
		});
	});

	describe("relations the ORM handed back in an unexpected shape", () => {
		const one: ConditionNode<Post> = {
			relation: "blog",
			type: "one",
			where: { field: "workspaceId", op: "eq", value: "w1" },
		};

		it("refuses to answer when a to-one relation arrived as a list", () => {
			expect(
				evaluateCondition(
					one,
					post({ blog: [{ id: "b1", workspaceId: "w1" }] as unknown as Blog }),
				),
			).toBeUndefined();
		});

		it("treats null as loaded and empty", () => {
			expect(evaluateCondition(one, post({ blog: null }))).toBe(false);
			expect(
				evaluateCondition(
					{
						relation: "comments",
						type: "many",
						match: "none",
						where: { field: "spam", op: "eq", value: true },
					},
					post({ comments: [] }),
				),
			).toBe(true);
		});

		it("throws when the relation is still a foreign key", () => {
			for (const key of [7, "b1", 7n]) {
				expect(() =>
					evaluateCondition(one, post({ blog: key as unknown as Blog })),
				).toThrow(RelationNotLoadedError);
			}
		});

		it("cannot decide when the relation holds something that is not a row", () => {
			expect(
				evaluateCondition(one, post({ blog: true as unknown as Blog })),
			).toBeUndefined();
		});

		it("cannot decide a to-many relation with no quantifier", () => {
			const node = {
				relation: "comments",
				type: "many",
				where: { field: "spam", op: "eq", value: true },
			} as unknown as ConditionNode<Post>;

			expect(
				evaluateCondition(node, post({ comments: [{ id: "c1", spam: true }] })),
			).toBeUndefined();
		});

		it("cannot decide a quantifier it does not know", () => {
			const node = {
				relation: "comments",
				type: "many",
				match: "most",
				where: { field: "spam", op: "eq", value: true },
			} as unknown as ConditionNode<Post>;

			expect(
				evaluateCondition(node, post({ comments: [{ id: "c1", spam: true }] })),
			).toBeUndefined();
		});
	});
});
