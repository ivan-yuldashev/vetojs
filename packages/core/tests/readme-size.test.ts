import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "tsup";
import { beforeAll, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../..", import.meta.url)).replace(
	/\\/g,
	"/",
);
const coreDist = `${repo}/packages/core/dist/index.js`;
const serverDist = `${repo}/packages/react/dist/server.js`;

async function ship(code: string) {
	const dir = mkdtempSync(join(tmpdir(), "veto-size-")).replace(/\\/g, "/");
	writeFileSync(`${dir}/entry.js`, code);
	await build({
		entry: [`${dir}/entry.js`],
		outDir: `${dir}/out`,
		format: ["esm"],
		minify: true,
		silent: true,
		config: false,
		sourcemap: false,
		splitting: false,
		external: ["react", "react/jsx-runtime"],
	});
	const emitted = readdirSync(`${dir}/out`);
	if (emitted.length !== 1) {
		throw new Error(`expected one bundle, got: ${emitted.join(", ")}`);
	}
	const bytes = readFileSync(`${dir}/out/${emitted[0]}`);
	rmSync(dir, { recursive: true, force: true });
	return {
		bytes: bytes.length,
		kB: (gzipSync(bytes).length / 1000).toFixed(1),
	};
}

const declare = `
const ac = defineAbilities({
	resources: {
		post: { schema: shape(), actions: ["read", "update", "publish"] },
		user: { schema: shape(), actions: ["read"] },
	},
});`;

const browser = `
import { defineAbilities, shape, buildAbility, parseRules } from "${coreDist}";${declare}
const parsed = parseRules(JSON.parse(globalThis.raw), ac);
if (!parsed.ok) throw new Error(parsed.errors.join("\\n"));
const ability = buildAbility(ac, parsed.rules);
globalThis.out = ability.can("update", "post", globalThis.post);
`;

const trusted = `
import { defineAbilities, shape, buildAbility } from "${coreDist}";${declare}
const ability = buildAbility(ac, globalThis.rules);
globalThis.out = ability.can("update", "post", globalThis.post);
`;

const whole = `export * from "${coreDist}";`;

const serverGate = `
import { Can } from "${serverDist}";
globalThis.out = Can;
`;

const size = { browser: "", trusted: "", whole: "", gate: 0 };

const claims = [
	{
		what: "browser bundle",
		en: /\*\*([\d.]+) kB gzipped\.?\*\*/,
		ru: /\*\*([\d.]+) kB в gzip\.?\*\*/,
		get: () => size.browser,
	},
	{
		what: "browser bundle, CASL table",
		en: /having first validated the rules that arrived \| no equivalent step \| ([\d.]+) kB gzip/,
		ru: /сперва проверив пришедшие правила \| такого шага нет \| ([\d.]+) kB gzip/,
		get: () => size.browser,
	},
	{
		what: "browser bundle on trusted rules",
		en: /already trusted, the size drops to ([\d.]+) kB/,
		ru: /доверять, размер падает до ([\d.]+) kB/,
		get: () => size.trusted,
	},
	{
		what: "browser bundle on trusted rules, CASL table",
		en: /check a row \| [\d.]+ kB gzip \| \*\*([\d.]+) kB gzip\*\*/,
		ru: /доверенных правил и проверить строку \| [\d.]+ kB gzip \| \*\*([\d.]+) kB gzip\*\*/,
		get: () => size.trusted,
	},
	{
		what: "whole package",
		en: /the whole package \| [\d.]+ kB gzip \| ([\d.]+) kB gzip/,
		ru: /весь пакет целиком \| [\d.]+ kB gzip \| ([\d.]+) kB gzip/,
		get: () => size.whole,
	},
	{
		what: "server gate",
		en: /(\d+) bytes/,
		ru: /(\d+) байт/,
		get: () => String(size.gate),
	},
];

const newestMtime = (dir: string) =>
	readdirSync(dir, { recursive: true, encoding: "utf8" }).reduce(
		(newest, name) => Math.max(newest, statSync(join(dir, name)).mtimeMs),
		0,
	);

const built =
	existsSync(coreDist) &&
	existsSync(serverDist) &&
	Math.min(statSync(coreDist).mtimeMs, statSync(serverDist).mtimeMs) >=
		Math.max(
			newestMtime(`${repo}/packages/core/src`),
			newestMtime(`${repo}/packages/react/src`),
		);

if (!built) {
	console.log(
		"readme-size: skipped — run `pnpm build` first, this measures dist/",
	);
}

describe.skipIf(!built)(
	"the README's bundle sizes are what a bundler produces",
	() => {
		beforeAll(async () => {
			size.browser = (await ship(browser)).kB;
			size.trusted = (await ship(trusted)).kB;
			size.whole = (await ship(whole)).kB;
			size.gate = (await ship(serverGate)).bytes;
		}, 120_000);

		for (const file of ["README.md", "README.ru.md"]) {
			for (const claim of claims) {
				it(`${file}: ${claim.what}`, () => {
					const text = readFileSync(`${repo}/${file}`, "utf8");
					const pattern = file.endsWith(".ru.md") ? claim.ru : claim.en;
					const found = [...text.matchAll(new RegExp(pattern.source, "g"))];

					expect(
						found.length,
						`expected a ${claim.what} claim in ${file} — did the wording change?`,
					).toBeGreaterThan(0);

					for (const match of found) {
						expect(match[1]).toBe(claim.get());
					}
				});
			}
		}
	},
);
