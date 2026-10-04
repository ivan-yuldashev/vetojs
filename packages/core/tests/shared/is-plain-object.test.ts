import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isPlainObject } from "../../src/shared/index.js";

class Entity {
	authorId = "u1";
}

class Ghost {
	authorId = "u1";
}

Object.setPrototypeOf(Ghost.prototype, null);

describe("what counts as a row", () => {
	it("reads a literal and an object without a prototype", () => {
		expect(isPlainObject({ authorId: "u1" })).toBe(true);
		expect(isPlainObject(Object.create(null))).toBe(true);
		expect(isPlainObject(JSON.parse('{"authorId":"u1"}'))).toBe(true);
	});

	it("reads an object that inherits from another literal", () => {
		expect(isPlainObject(Object.create({ inherited: 1 }))).toBe(true);
	});

	it("reads a row that came from another realm", () => {
		expect(isPlainObject(runInNewContext("({ authorId: 'u1' })"))).toBe(true);
	});

	it("reads a row whose own key is named constructor", () => {
		expect(isPlainObject(JSON.parse('{"constructor":1}'))).toBe(true);
		expect(isPlainObject({ constructor: "Entity" })).toBe(true);
	});
});

describe("what does not count as a row", () => {
	it("refuses a class instance", () => {
		expect(isPlainObject(new Entity())).toBe(false);
	});

	it("refuses a class instance whose prototype chain was cut", () => {
		expect(isPlainObject(new Ghost())).toBe(false);
	});

	it("refuses the built-in objects that are not records", () => {
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject(new Date())).toBe(false);
		expect(isPlainObject(new Map())).toBe(false);
		expect(isPlainObject(new Set())).toBe(false);
		expect(isPlainObject(/x/)).toBe(false);
		expect(isPlainObject(Promise.resolve())).toBe(false);
	});

	it("refuses a row whose own constructor key holds a function", () => {
		expect(isPlainObject({ constructor: () => "u1" })).toBe(false);
	});

	it("refuses everything that is not an object", () => {
		expect(isPlainObject(null)).toBe(false);
		expect(isPlainObject(undefined)).toBe(false);
		expect(isPlainObject("row")).toBe(false);
		expect(isPlainObject(42)).toBe(false);
		expect(isPlainObject(true)).toBe(false);
		expect(isPlainObject(Symbol("row"))).toBe(false);
		expect(isPlainObject(() => "u1")).toBe(false);
	});
});
