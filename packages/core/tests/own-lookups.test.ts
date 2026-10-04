import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../..", import.meta.url));

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);

		if (entry.isDirectory()) {
			return sources(path);
		}

		return entry.name.endsWith(".ts") ? [path] : [];
	});

const NAMED_BY_A_RULE =
	/[\w)\].]\[(resource|action|field|key|name|relation|relationName)\]/;
const KEY = /\[\w+\]\s*(=[^=]|:)/;
const COMMENT = /^\s*(\*|\/\/|\/\*)/;

const OWN_BY_CONSTRUCTION = [
	[join("core", "src", "create", "condition-shorthand.ts"), "shorthand[key]"],
	[join("core", "src", "check", "rule.ts"), "payload[field]"],
] as const;

const isOwnByConstruction = (path: string, line: string): boolean =>
	OWN_BY_CONSTRUCTION.some(
		([file, read]) => path.endsWith(file) && line.includes(read),
	);

describe("a name a rule can carry is read as an own property", () => {
	const files = readdirSync(join(repo, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			try {
				return sources(join(repo, "packages", entry.name, "src"));
			} catch {
				return [];
			}
		})
		.filter((path) => !path.endsWith("own.ts"));

	it("scans every package source", () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it("finds no bracket read of one", () => {
		const found = files.flatMap((path) =>
			readFileSync(path, "utf8")
				.split("\n")
				.flatMap((line, index) =>
					NAMED_BY_A_RULE.test(line) &&
					!KEY.test(line) &&
					!COMMENT.test(line) &&
					!isOwnByConstruction(path, line)
						? [`${path.slice(repo.length)}:${index + 1} ${line.trim()}`]
						: [],
				),
		);

		expect(
			found,
			`read these through own() — a rule may name them "constructor" or "__proto__":\n${found.join("\n")}`,
		).toEqual([]);
	});

	it("lets through only reads that exist, of keys taken from the object read", () => {
		for (const [file, read] of OWN_BY_CONSTRUCTION) {
			const source = files.find((path) => path.endsWith(file));

			expect(source, file).toBeDefined();
			expect(readFileSync(source ?? "", "utf8")).toContain(read);
		}
	});
});
