import { describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { RelationNotLoadedError } from "../../src/errors/index.js";

type User = { id: string; role: string };
type Post = { id: string; author?: User; editors?: User[] };

const ac = defineAbilities({
	resources: {
		post: {
			schema: shape<Post>(),
			actions: ["read"],
			relations: {
				author: { resource: "user", kind: "one" },
				editors: { resource: "user", kind: "many" },
			},
		},
		user: { schema: shape<User>(), actions: ["read"] },
	},
});

const { allow, deny } = createRules(ac);

const admin: User = { id: "u1", role: "admin" };

const askedAs = (row: unknown) => {
	const granted = buildAbility(ac, [
		allow("read", "post", { where: { editors: { some: { role: "admin" } } } }),
	]).can("read", "post", row as Post);
	const refused = buildAbility(ac, [
		allow("read", "post"),
		deny("read", "post", { where: { editors: { some: { role: "admin" } } } }),
	]).can("read", "post", row as Post);

	return { granted, refused: !refused };
};

describe("related rows are read in the shape the relation declares", () => {
	it("takes a list for a to-many relation", () => {
		expect(askedAs({ id: "p", editors: [admin] })).toEqual({
			granted: true,
			refused: true,
		});
	});

	it("does not know a to-many relation that holds one row", () => {
		expect(askedAs({ id: "p", editors: admin })).toEqual({
			granted: false,
			refused: true,
		});
	});

	it("does not know a to-one relation that holds a list", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post", { where: { author: { role: "admin" } } }),
		]);

		expect(
			ability.can("read", "post", { id: "p", author: [admin] } as never),
		).toBe(false);
	});
});

describe("an id among related rows", () => {
	it("means the relation was not loaded, wherever it stands", () => {
		for (const editors of [
			["u2", admin],
			[admin, "u2"],
			[null, "u2"],
		]) {
			expect(() => askedAs({ id: "p", editors })).toThrow(
				RelationNotLoadedError,
			);
		}
	});
});

describe("a payload with no row", () => {
	it("asks for no relation, and is refused by a condition that needs one", () => {
		const ability = buildAbility(ac, [
			allow("read", "post"),
			deny("read", "post", { where: { author: { role: "banned" } } }),
		]);

		expect(ability.validatePayload("read", "post", undefined, {})).toEqual({
			ok: false,
			violations: [],
		});
	});
});
