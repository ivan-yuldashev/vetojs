import { join } from "node:path";

const core = join(import.meta.dirname, "packages/core/src");

export const coreAlias = [
	{ find: /^@vetojs\/core$/, replacement: join(core, "index.ts") },
];
