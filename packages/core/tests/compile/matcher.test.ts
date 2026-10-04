import { describe, expect, it } from "vitest";
import { compileMatcher } from "../../src/compile/index.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";
import type { ConditionNode } from "../../src/model/index.js";
import { markLoaded } from "../../src/row/index.js";

type User = { id: string; role: "admin" | "user" };
type Workspace = { id: string; plan: string };
type Blog = { id: string; workspaceId: string; workspace?: Workspace | null };
type Comment = { id: string; spam: boolean; blog?: Blog | null };

type Post = {
	authorId: string;
	status: "draft" | "published" | "archived";
	views: number;
	author?: User | null;
	blog?: Blog | null;
	comments?: Comment[];
};

const createPost = (overrides?: Partial<Post>): Post => ({
	authorId: "u1",
	status: "published",
	views: 120,
	...overrides,
});

const createPostWithRelations = (overrides?: Partial<Post>): Post => ({
	...createPost(),
	author: { id: "u1", role: "admin" },
	comments: [
		{ id: "c1", spam: false },
		{ id: "c2", spam: true },
	],
	...overrides,
});

const createPostWithNullRelation = (overrides?: Partial<Post>): Post => ({
	...createPost(),
	author: null,
	comments: [],
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

describe("compileMatcher", () => {
	describe("logical combinators", () => {
		it("evaluates empty 'and' array to true (Vacuous Truth)", () => {
			expect(compileMatcher({ and: [] })(createPost())).toBe(true);
		});

		it("evaluates empty 'or' array to false", () => {
			expect(compileMatcher({ or: [] })(createPost())).toBe(false);
		});

		it("needs every branch of an and and one branch of an or", () => {
			const holds: ConditionNode<Post> = {
				field: "status",
				op: "eq",
				value: "published",
			};
			const fails: ConditionNode<Post> = {
				field: "views",
				op: "eq",
				value: 0,
			};

			expect(compileMatcher({ and: [holds, holds] })(createPost())).toBe(true);
			expect(compileMatcher({ and: [holds, fails] })(createPost())).toBe(false);
			expect(compileMatcher({ or: [fails, holds] })(createPost())).toBe(true);
			expect(compileMatcher({ or: [fails, fails] })(createPost())).toBe(false);
		});

		it("flips what not wraps", () => {
			expect(
				compileMatcher<Post>({
					not: { field: "status", op: "eq", value: "published" },
				})(createPost()),
			).toBe(false);
			expect(
				compileMatcher<Post>({
					not: { field: "status", op: "eq", value: "draft" },
				})(createPost()),
			).toBe(true);
		});

		it("handles double negation correctly", () => {
			expect(
				compileMatcher<Post>({
					not: { not: { field: "status", op: "eq", value: "published" } },
				})(createPost()),
			).toBe(true);
		});

		const unreadable: ConditionNode<Post> = {
			field: "authorId",
			op: "eq",
			value: "u1",
		};
		const decidedFalse: ConditionNode<Post> = {
			field: "status",
			op: "eq",
			value: "draft",
		};
		const confused = createPost({ authorId: ["u1"] as unknown as string });

		it("keeps an unknown from overriding an already decided false in and", () => {
			expect(compileMatcher(unreadable)(confused)).toBeUndefined();
			expect(
				compileMatcher({ and: [decidedFalse, unreadable] })(confused),
			).toBe(false);
			expect(
				compileMatcher({ and: [unreadable, decidedFalse] })(confused),
			).toBe(false);
		});

		it("keeps an unknown unknown under not", () => {
			expect(compileMatcher({ not: unreadable })(confused)).toBeUndefined();
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
			const loaded = createPost({ comments: [{ id: "c1", spam: true }] });

			expect(
				compileMatcher({
					and: [{ field: "views", op: "eq", value: 0 }, unloaded],
				})(loaded),
			).toBe(false);

			expect(
				compileMatcher({
					and: [unloaded, { field: "views", op: "eq", value: 0 }],
				})(loaded),
			).toBe(false);
		});

		it("keeps a true in an or, whatever sits beside it", () => {
			const loaded = createPost({ comments: [] });

			expect(
				compileMatcher({
					or: [{ field: "views", op: "eq", value: 120 }, unloaded],
				})(loaded),
			).toBe(true);

			expect(
				compileMatcher({
					or: [unloaded, { field: "views", op: "eq", value: 120 }],
				})(loaded),
			).toBe(true);
		});

		it("reports undefined, not false, when a branch could not be decided", () => {
			const garbled = createPost({
				// @ts-expect-error the relation arrived as something no ORM would return
				comments: [true],
			});

			expect(compileMatcher(unloaded)(garbled)).toBeUndefined();
			expect(
				compileMatcher({
					and: [{ field: "views", op: "eq", value: 120 }, unloaded],
				})(garbled),
			).toBeUndefined();
			expect(
				compileMatcher({
					or: [{ field: "views", op: "eq", value: 0 }, unloaded],
				})(garbled),
			).toBeUndefined();
			expect(compileMatcher({ not: unloaded })(garbled)).toBeUndefined();
		});
	});

	describe("a node the rule itself gets wrong", () => {
		it("answers unknown for an operator it does not know", () => {
			for (const op of ["like", "EQ", undefined]) {
				const node = { field: "authorId", op, value: "u1" };

				expect(
					compileMatcher(node as unknown as ConditionNode<Post>)(createPost()),
				).toBeUndefined();
			}
		});
	});

	describe("the same node asked repeatedly", () => {
		it("answers per instance, not per first instance", () => {
			const node: ConditionNode<Post> = {
				field: "authorId",
				op: "eq",
				value: "u1",
			};

			expect(compileMatcher(node)(createPost())).toBe(true);
			expect(compileMatcher(node)(createPost({ authorId: "u2" }))).toBe(false);
			expect(compileMatcher(node)(createPost())).toBe(true);
		});

		it("keeps two rules sharing one node object in agreement", () => {
			const shared: ConditionNode<Post> = {
				field: "status",
				op: "eq",
				value: "published",
			};

			const wrapped: ConditionNode<Post> = { and: [shared, shared] };

			expect(compileMatcher(shared)(createPost())).toBe(true);
			expect(compileMatcher(wrapped)(createPost())).toBe(true);
			expect(compileMatcher(shared)(createPost({ status: "draft" }))).toBe(
				false,
			);
			expect(compileMatcher(wrapped)(createPost({ status: "draft" }))).toBe(
				false,
			);
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

			const clean = createPost({ comments: [{ id: "c1", spam: false }] });

			expect(compileMatcher(inRelation)(clean)).toBe(true);
			expect(compileMatcher(leaf)({ id: "c1", spam: false })).toBe(true);
			expect(compileMatcher(leaf)({ id: "c2", spam: true })).toBe(false);
			expect(compileMatcher(inRelation)(clean)).toBe(true);
		});
	});

	describe("what the row may not smuggle in", () => {
		const authorId: ConditionNode<Post> = {
			field: "authorId",
			op: "eq",
			value: "u1",
		};

		it("handles undefined properties gracefully", () => {
			const partialPost = { status: "published" } as Post;
			expect(
				compileMatcher<Post>({ field: "views", op: "eq", value: 100 })(
					partialPost,
				),
			).toBe(false);
		});

		it("reads own fields only, never the prototype chain", () => {
			const inherited = Object.create({ authorId: "u1" }) as Post;

			expect(compileMatcher(authorId)(inherited)).toBe(false);
		});

		it("is not fooled by a row built without a prototype", () => {
			const bare = Object.assign(Object.create(null), {
				authorId: "u1",
			}) as Post;

			expect(compileMatcher(authorId)(bare)).toBe(true);
		});

		it("treats __proto__, constructor and prototype as ordinary field names", () => {
			for (const field of ["__proto__", "constructor", "prototype"]) {
				const node = { field, op: "eq", value: "x" } as ConditionNode<Post>;

				expect(compileMatcher(node)(createPost())).toBe(false);
				expect(
					compileMatcher(node)(
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

			expect(compileMatcher(node)(createPost())).toBe(false);
		});

		it("reads a numeric field as the string key an object actually has", () => {
			const node = { field: 0, op: "eq", value: "first" } as unknown as
				| ConditionNode<Post>
				| never;

			expect(compileMatcher(node)({ 0: "first" } as unknown as Post)).toBe(
				true,
			);
			expect(compileMatcher(node)(createPost())).toBe(false);
		});

		it("leaves the row it read exactly as it found it", () => {
			const row = createPost();
			const before = JSON.stringify(row);

			compileMatcher(authorId)(row);

			expect(JSON.stringify(row)).toBe(before);
		});
	});

	describe("relation", () => {
		describe("1. Happy Path (Valid Data & Logical Combinators)", () => {
			it("evaluates 'one' relation correctly", () => {
				const node: ConditionNode<Post> = {
					relation: "author",
					type: "one",
					where: { field: "role", op: "eq", value: "admin" },
				};
				expect(compileMatcher(node)(createPostWithRelations())).toBe(true);

				const nodeFalse: ConditionNode<Post> = {
					...node,
					where: { field: "role", op: "eq", value: "user" },
				};
				expect(compileMatcher(nodeFalse)(createPostWithRelations())).toBe(
					false,
				);
			});

			it("evaluates 'many' relation with 'some' match", () => {
				const node: ConditionNode<Post> = {
					relation: "comments",
					type: "many",
					match: "some",
					where: { field: "spam", op: "eq", value: true },
				};
				expect(compileMatcher(node)(createPostWithRelations())).toBe(true);

				const nodeFalse: ConditionNode<Post> = {
					...node,
					where: { field: "id", op: "eq", value: "c99" },
				};
				expect(compileMatcher(nodeFalse)(createPostWithRelations())).toBe(
					false,
				);
			});

			it("evaluates 'many' relation with 'every' match", () => {
				const node: ConditionNode<Post> = {
					relation: "comments",
					type: "many",
					match: "every",
					where: { field: "spam", op: "eq", value: false },
				};
				expect(compileMatcher(node)(createPostWithRelations())).toBe(false);
			});

			it("evaluates 'many' relation with 'none' match", () => {
				const node: ConditionNode<Post> = {
					relation: "comments",
					type: "many",
					match: "none",
					where: { field: "id", op: "eq", value: "c99" },
				};
				expect(compileMatcher(node)(createPostWithRelations())).toBe(true);
			});

			it("evaluates relations nested inside logical combinators", () => {
				const node: ConditionNode<Post> = {
					and: [
						{ field: "status", op: "eq", value: "published" },
						{
							relation: "comments",
							type: "many",
							match: "some",
							where: { field: "spam", op: "eq", value: true },
						},
					],
				};
				expect(compileMatcher(node)(createPostWithRelations())).toBe(true);
			});

			it("evaluates a relation nested inside another relation's where (AST Recursion)", () => {
				type PostWithBlog = { blog?: { workspace?: { id: string } | null } };

				const instance: PostWithBlog = { blog: { workspace: { id: "w9" } } };
				const node: ConditionNode<PostWithBlog> = {
					relation: "blog",
					type: "one",
					where: {
						relation: "workspace",
						type: "one",
						where: { field: "id", op: "eq", value: "w9" },
					},
				};

				expect(compileMatcher(node)(instance)).toBe(true);
			});

			it("answers every quantifier through a relation nested in each item", () => {
				const loaded = (plan: string, id: string): Comment => ({
					id,
					spam: false,
					blog: { id, workspaceId: id, workspace: { id, plan } },
				});

				const comments = [loaded("pro", "c1"), loaded("free", "c2")];
				const through = (match: "some" | "every" | "none") =>
					compileMatcher<Post>({
						relation: "comments",
						type: "many",
						match,
						where: reachesWorkspace,
					})(createPost({ comments }));

				expect(through("some")).toBe(true);
				expect(through("every")).toBe(false);
				expect(through("none")).toBe(false);
			});
		});

		describe("2. Fail-Fast (Level 2: Catching Missing JOINs)", () => {
			const node: ConditionNode<Post> = {
				relation: "comments",
				type: "many",
				match: "some",
				where: { field: "spam", op: "eq", value: true },
			};

			it("throws RelationNotLoadedError when relation is completely undefined", () => {
				expect(() => compileMatcher(node)(createPost())).toThrow(
					RelationNotLoadedError,
				);
			});

			it("carries the relation name on RelationNotLoadedError for audit", () => {
				expect(() => compileMatcher(node)(createPost())).toThrowError(
					expect.objectContaining({ relation: "comments" }),
				);
			});

			it("throws from under a not", () => {
				expect(() => compileMatcher({ not: node })(createPost())).toThrow(
					RelationNotLoadedError,
				);
			});

			it("throws when relation is an array of foreign keys (Numbers)", () => {
				// @ts-expect-error: simulate a DB loading error (foreign keys instead of objects)
				const fkArray = createPost({ comments: [1, 2, 3] });
				expect(() => compileMatcher(node)(fkArray)).toThrow(
					RelationNotLoadedError,
				);
			});

			it("throws when relation is an array of foreign keys (Strings)", () => {
				// @ts-expect-error
				const fkArray = createPost({ comments: ["c1", "c2"] });
				expect(() => compileMatcher(node)(fkArray)).toThrow(
					RelationNotLoadedError,
				);
			});

			it("throws RelationNotLoadedError when relation array contains a mix of valid objects and garbage", () => {
				const mixedGarbage = createPost({
					// @ts-expect-error a mix of an object and a foreign key (loading error)
					comments: [{ id: "c1", spam: false }, 123],
				});
				expect(() => compileMatcher(node)(mixedGarbage)).toThrowError(
					expect.objectContaining({ relation: "comments" }),
				);
			});

			it("throws when a to-one relation is still a foreign key", () => {
				const one: ConditionNode<Post> = {
					relation: "blog",
					type: "one",
					where: { field: "workspaceId", op: "eq", value: "w1" },
				};

				for (const key of [7, "b1", 7n]) {
					expect(() =>
						compileMatcher(one)(createPost({ blog: key as unknown as Blog })),
					).toThrow(RelationNotLoadedError);
				}
			});
		});

		describe("3. Fail-Closed & Trojan Horse Protection (Level 3: Handling DB Garbage)", () => {
			const denySpamNode: ConditionNode<Post> = {
				relation: "comments",
				type: "many",
				match: "none",
				where: { field: "spam", op: "eq", value: true },
			};

			it("returns undefined (not a silent false) if a Trojan Horse element is present in the array", () => {
				const dirtyInstance = createPost({
					comments: [
						{ id: "c1", spam: false },
						// @ts-expect-error null — garbage inside the array (dirty DB)
						null,
					],
				});

				expect(compileMatcher(denySpamNode)(dirtyInstance)).toBeUndefined();
			});

			it("returns undefined for a completely garbage relation object (not an array/object)", () => {
				const garbageInstance = createPost({
					// @ts-expect-error a Date instead of the comments array (garbage)
					comments: new Date(),
				});
				expect(compileMatcher(denySpamNode)(garbageInstance)).toBeUndefined();
			});

			it("returns undefined when a to-one relation holds something that is not a row", () => {
				expect(
					compileMatcher<Post>({
						relation: "blog",
						type: "one",
						where: { field: "workspaceId", op: "eq", value: "w1" },
					})(createPost({ blog: true as unknown as Blog })),
				).toBeUndefined();
			});

			const toOneAdminNode: ConditionNode<Post> = {
				relation: "author",
				type: "one",
				where: { field: "role", op: "eq", value: "admin" },
			};

			it("returns undefined when a to-one relation is delivered as an array (cardinality violation)", () => {
				const arrayAsToOne = createPost({
					// @ts-expect-error author as an array instead of one object — cardinality violation
					author: [
						{ id: "u2", role: "user" },
						{ id: "u1", role: "admin" },
					],
				});
				expect(compileMatcher(toOneAdminNode)(arrayAsToOne)).toBeUndefined();
			});

			it("still evaluates a well-formed single-object to-one normally", () => {
				expect(
					compileMatcher(toOneAdminNode)(
						createPost({ author: { id: "u1", role: "admin" } }),
					),
				).toBe(true);
				expect(
					compileMatcher(toOneAdminNode)(
						createPost({ author: { id: "u2", role: "user" } }),
					),
				).toBe(false);
			});

			it("returns undefined for a to-many relation with no quantifier", () => {
				const node = {
					relation: "comments",
					type: "many",
					where: { field: "spam", op: "eq", value: true },
				} as unknown as ConditionNode<Post>;

				expect(
					compileMatcher(node)(
						createPost({ comments: [{ id: "c1", spam: true }] }),
					),
				).toBeUndefined();
			});

			it("returns undefined for a quantifier it does not recognise", () => {
				const node = {
					relation: "comments",
					type: "many",
					match: "most",
					where: { field: "spam", op: "eq", value: true },
				} as unknown as ConditionNode<Post>;

				expect(
					compileMatcher(node)(
						createPost({ comments: [{ id: "c1", spam: true }] }),
					),
				).toBeUndefined();
			});
		});

		describe("4. Vacuous Truths (Empty Collections)", () => {
			const makeNode = (
				match: "some" | "every" | "none",
			): ConditionNode<Post> => ({
				relation: "comments",
				type: "many",
				match,
				where: { field: "spam", op: "eq", value: true },
			});

			it("resolves empty arrays mathematically correct", () => {
				const nullRel = createPostWithNullRelation();
				expect(compileMatcher(makeNode("some"))(nullRel)).toBe(false);
				expect(compileMatcher(makeNode("every"))(nullRel)).toBe(true);
				expect(compileMatcher(makeNode("none"))(nullRel)).toBe(true);
			});

			it("resolves null relations mathematically correct (treats as empty collection)", () => {
				// @ts-expect-error: force null instead of an array
				const nullPost = createPost({ comments: null });
				expect(compileMatcher(makeNode("some"))(nullPost)).toBe(false);
				expect(compileMatcher(makeNode("every"))(nullPost)).toBe(true);
				expect(compileMatcher(makeNode("none"))(nullPost)).toBe(true);
			});

			it("handles null in to-one relation safely", () => {
				const toOneNode: ConditionNode<Post> = {
					relation: "author",
					type: "one",
					where: { field: "role", op: "eq", value: "admin" },
				};
				expect(compileMatcher(toOneNode)(createPostWithNullRelation())).toBe(
					false,
				);
			});
		});

		describe("markLoaded — explicit load marker", () => {
			const node: ConditionNode<Post> = {
				relation: "comments",
				type: "many",
				match: "some",
				where: { field: "spam", op: "eq", value: true },
			};

			it("treats a marked-loaded null relation as empty (no throw)", () => {
				const marked = markLoaded(createPost(), "comments", null);
				expect(() => compileMatcher(node)(marked)).not.toThrow();
				expect(compileMatcher(node)(marked)).toBe(false);
			});

			it("reads the rows a relation was marked loaded with", () => {
				const marked = markLoaded(createPost(), "comments", [
					{ id: "c1", spam: true },
				] as Comment[]);

				expect(compileMatcher(node)(marked)).toBe(true);
			});
		});
	});
});

describe("a leaf of one's own", () => {
	it("reaches every condition nested under and, or and not", () => {
		const nested = {
			and: [
				{ or: [{ field: "x", op: "eq", value: "v" }] },
				{ not: { not: { field: "y", op: "eq", value: "v" } } },
			],
		} as unknown as ConditionNode<Post>;

		expect(compileMatcher(nested, () => () => true)({})).toBe(true);
		expect(compileMatcher(nested)({})).toBe(false);
	});
});

describe("a comparison of two fields", () => {
	const lte = {
		field: "spent",
		op: "lte",
		ref: "limit",
	} as unknown as ConditionNode<Post>;
	const match = compileMatcher(lte);

	it("compares the field with the other field of the same row", () => {
		expect(match({ spent: 1, limit: 2 })).toBe(true);
		expect(match({ spent: 3, limit: 2 })).toBe(false);
	});

	it("answers unknown when either side cannot be compared", () => {
		for (const row of [
			{ limit: 2 },
			{ spent: 1 },
			{ spent: null, limit: null },
			{ spent: Number.NaN, limit: 2 },
			{ spent: 1, limit: Number.NaN },
			Object.assign(Object.create({ limit: 2 }), { spent: 1 }),
		]) {
			expect(match(row)).toBeUndefined();
		}

		expect(
			compileMatcher({
				field: "spent",
				op: "eq",
				ref: "limit",
			} as unknown as ConditionNode<Post>)({
				spent: Number.NaN,
				limit: Number.NaN,
			}),
		).toBeUndefined();
	});
});
