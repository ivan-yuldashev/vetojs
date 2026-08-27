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
	/\[(resource|action|field|key|name|relation|relationName)\]/;
const KEY = /\[\w+\]\s*(=[^=]|:)/;
const COMMENT = /^\s*(\*|\/\/|\/\*)/;

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
					NAMED_BY_A_RULE.test(line) && !KEY.test(line) && !COMMENT.test(line)
						? [`${path.slice(repo.length)}:${index + 1} ${line.trim()}`]
						: [],
				),
		);

		expect(
			found,
			`read these through own() — a rule may name them "constructor" or "__proto__":\n${found.join("\n")}`,
		).toEqual([]);
	});
});
