import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROUNDS = Number(process.env.ROUNDS ?? 10);
const SLICE_NS = BigInt(process.env.SLICE_NS ?? 2.5e8);
const BATCH = 128;
const side = process.env.BENCH_SIDE;
const rowShape = process.env.BENCH_ROWS;

const me = { id: "u7" };

const posts = Array.from({ length: 100 }, (_, index) => ({
	id: `p${index}`,
	authorId: index % 3 === 0 ? me.id : `u${index}`,
	status: index % 2 === 0 ? "published" : "draft",
	views: index * 7,
}));

const refused = [posts[2], posts[3]];

const comments = [
	{ id: "c1", spam: false },
	{ id: "c2", spam: true },
];

const resources = ["post", "comment", "invoice", "ticket", "report", "file"];
const TENANTS = 36;
const KEYS = ["f0", "f1", "f2", "f3", "f4", "tenant"];

const tenantRow = (index) => ({
	tenant: `t${index}`,
	blocked: false,
	f0: `v${index}0`,
	f1: `v${index}1`,
	f2: `v${index}2`,
	f3: `v${index}3`,
	f4: `v${index}4`,
});

const nearMiss = (index, key) => ({ ...tenantRow(index), [key]: "miss" });

const tenants = Array.from({ length: TENANTS }, (_, index) => index);
const matching = tenants.map((index) => tenantRow(index));
const missing = tenants.map((index) =>
	nearMiss(index, KEYS[index % KEYS.length]),
);
const missingOwn = KEYS.map((key) => nearMiss(0, key));
const blocked = tenants.map((index) => ({
	...tenantRow(index),
	blocked: true,
}));
const owner = { id: "o1", role: "admin" };
const guest = { id: "o2", role: "guest" };

const inValues = (index, key) => [`v${index}${key}`, `w${index}${key}`];

const entities = Object.fromEntries(
	[...resources, "owner"].map((name) => [
		name,
		class {
			static modelName = name;

			constructor(source) {
				Object.assign(this, source);
			}
		},
	]),
);

const fresh = (resource, source) =>
	rowShape === "class" ? new entities[resource](source) : { ...source };

const vetoSide = async () => {
	const { buildAbility, createRules, defineAbilities, parseRules, shape } =
		await import("@vetojs/core");

	const blogAc = defineAbilities({
		resources: {
			post: { schema: shape(), actions: ["read", "update", "publish"] },
			comment: { schema: shape(), actions: ["read"] },
		},
	});

	const blog = createRules(blogAc);

	const blogPolicy = (user) => [
		blog.allow("read", "post", { where: { status: "published" } }),
		blog.allow("read", "post", { where: { authorId: user.id } }),
		blog.allow(["update", "publish"], "post", {
			where: { authorId: user.id, status: { ne: "draft" } },
		}),
		blog.allow("read", "comment"),
		blog.deny("read", "comment", { where: { spam: true } }),
	];

	const tenantAc = defineAbilities({
		resources: {
			...Object.fromEntries(
				resources.map((name) => [
					name,
					{
						schema: shape(),
						actions: ["read"],
						relations: { owner: { resource: "owner", kind: "one" } },
					},
				]),
			),
			owner: { schema: shape(), actions: ["read"] },
		},
	});

	const tenant = createRules(tenantAc);

	const tenantPolicy = (perResource) =>
		resources.flatMap((name) => [
			...Array.from({ length: perResource }, (_, index) =>
				tenant.allow("read", name, {
					where: {
						f0: { in: inValues(index, 0) },
						f1: { in: inValues(index, 1) },
						f2: { in: inValues(index, 2) },
						f3: { in: inValues(index, 3) },
						f4: { in: inValues(index, 4) },
						tenant: { in: [`t${index}`] },
					},
				}),
			),
			tenant.deny("read", name, { where: { blocked: true } }),
		]);

	return {
		blog: () => buildAbility(blogAc, blogPolicy(me)),
		fromJson: (text) => buildAbility(blogAc, JSON.parse(text)),
		byRole: () => buildAbility(tenantAc, tenantPolicy(1)),
		perTenant: () => buildAbility(tenantAc, tenantPolicy(TENANTS)),
		throughOwner: () =>
			buildAbility(tenantAc, [
				tenant.allow("read", "post", { where: { owner: { role: "admin" } } }),
			]),
		can:
			rowShape === "class"
				? (ability, action, resource, row) =>
						ability.can(
							action,
							resource,
							row.owner === undefined
								? { ...row }
								: { ...row, owner: { ...row.owner } },
						)
				: (ability, action, resource, row) =>
						ability.can(action, resource, row),
		only: (ability, raw) => ({
			"ability.where() for the database": [
				1,
				() => undefined,
				() => (ability.where("read", "post") === undefined ? 0 : 1),
			],
			"untrusted rules as JSON: parseRules, build, then check one row": [
				1,
				() => ({ ...posts[0] }),
				(row) => {
					const parsed = parseRules(JSON.parse(raw));

					if (!parsed.ok) {
						throw new Error("parseRules refused the rules");
					}

					return buildAbility(blogAc, parsed.rules).can("update", "post", row)
						? 1
						: 0;
				},
			],
		}),
	};
};

const caslSide = async () => {
	const { createMongoAbility, subject } = await import("@casl/ability");

	const blogRules = (user) => [
		{ action: "read", subject: "post", conditions: { status: "published" } },
		{ action: "read", subject: "post", conditions: { authorId: user.id } },
		{
			action: ["update", "publish"],
			subject: "post",
			conditions: { authorId: user.id, status: { $ne: "draft" } },
		},
		{ action: "read", subject: "comment" },
		{
			action: "read",
			subject: "comment",
			conditions: { spam: true },
			inverted: true,
		},
	];

	const tenantRules = (perResource) =>
		resources.flatMap((name) => [
			...Array.from({ length: perResource }, (_, index) => ({
				action: "read",
				subject: name,
				conditions: {
					f0: { $in: inValues(index, 0) },
					f1: { $in: inValues(index, 1) },
					f2: { $in: inValues(index, 2) },
					f3: { $in: inValues(index, 3) },
					f4: { $in: inValues(index, 4) },
					tenant: { $in: [`t${index}`] },
				},
			})),
			{
				action: "read",
				subject: name,
				conditions: { blocked: true },
				inverted: true,
			},
		]);

	return {
		blog: () => createMongoAbility(blogRules(me)),
		fromJson: (text) => createMongoAbility(JSON.parse(text)),
		byRole: () => createMongoAbility(tenantRules(1)),
		perTenant: () => createMongoAbility(tenantRules(TENANTS)),
		throughOwner: () =>
			createMongoAbility([
				{
					action: "read",
					subject: "post",
					conditions: { "owner.role": "admin" },
				},
			]),
		can:
			rowShape === "class"
				? (ability, action, _resource, row) => ability.can(action, row)
				: (ability, action, resource, row) =>
						ability.can(action, subject(resource, row)),
		only: () => ({}),
	};
};

const rotate = (list) => {
	let at = -1;

	return () => {
		at = at + 1 === list.length ? 0 : at + 1;

		return list[at];
	};
};

const run = async () => {
	const firstPage = posts.map((row) => fresh("post", row));

	const started = performance.now();
	const engine = side === "veto" ? await vetoSide() : await caslSide();
	const imported = performance.now();
	const { can } = engine;
	const firstAbility = engine.blog();
	let firstAllowed = can(firstAbility, "update", "post", firstPage[0]) ? 1 : 0;
	const checked = performance.now();

	for (let index = 1; index < firstPage.length; index++) {
		firstAllowed += can(firstAbility, "update", "post", firstPage[index])
			? 1
			: 0;
	}

	const gated = performance.now();

	if (firstAllowed !== 17) {
		throw new Error(`the cold start allowed ${firstAllowed}, expected 17`);
	}

	const results = {
		"cold start: import and set up": (imported - started) * 1e6,
		"cold start: build, then check one row": (checked - imported) * 1e6,
		"cold start: build, then gate a hundred rows": (gated - imported) * 1e6,
	};

	const blog = engine.blog();
	const byRole = engine.byRole();
	const perTenant = engine.perTenant();
	const throughOwner = engine.throughOwner();

	const loaded = (who) =>
		fresh("post", { ...matching[0], owner: fresh("owner", who) });

	const answers = [
		...["read", "update", "publish"].flatMap((action) =>
			posts.map((row) => can(blog, action, "post", fresh("post", row))),
		),
		...comments.map((row) =>
			can(blog, "read", "comment", fresh("comment", row)),
		),
		...[byRole, perTenant].flatMap((ability) =>
			resources.flatMap((name) =>
				[...matching, ...missing, ...missingOwn, ...blocked].map((row) =>
					can(ability, "read", name, fresh(name, row)),
				),
			),
		),
		...[owner, guest].map((who) =>
			can(throughOwner, "read", "post", loaded(who)),
		),
	];

	const raw = JSON.stringify(blog.rules);

	const post = (rows) => {
		const pick = rotate(rows);

		return () => fresh("post", pick());
	};

	const hundred = () => posts.map((row) => fresh("post", row));

	const verdict = (ability, action, row) =>
		can(ability, action, "post", row) ? 1 : 0;

	const gate = (ability, rows) => {
		let allowed = 0;

		for (const row of rows) {
			allowed += verdict(ability, "update", row);
		}

		return allowed;
	};

	const cases = {
		"check one row": [
			1,
			post([posts[0]]),
			(row) => verdict(blog, "update", row),
		],
		"refuse one row": [0, post(refused), (row) => verdict(blog, "update", row)],
		"gate a hundred rows": [17, hundred, (rows) => gate(blog, rows)],
		"build the ability for a request": [
			5,
			() => undefined,
			() => engine.blog().rules.length,
		],
		"build, then check one row": [
			1,
			post([posts[0]]),
			(row) => verdict(engine.blog(), "update", row),
		],
		"build, then gate a hundred rows": [
			17,
			hundred,
			(rows) => gate(engine.blog(), rows),
		],
		"12 rules by role, the row matches": [
			1,
			post([matching[0]]),
			(row) => verdict(byRole, "read", row),
		],
		"12 rules by role, nothing matches": [
			0,
			post(missingOwn),
			(row) => verdict(byRole, "read", row),
		],
		"222 rules per tenant, a row of any tenant matches": [
			1,
			post(matching),
			(row) => verdict(perTenant, "read", row),
		],
		"222 rules per tenant, nothing matches": [
			0,
			post(missing),
			(row) => verdict(perTenant, "read", row),
		],
		"222 rules per tenant: build, then check one row": [
			1,
			post(matching),
			(row) => verdict(engine.perTenant(), "read", row),
		],
		"a rule reaching through a loaded relation": [
			1,
			() => loaded(owner),
			(row) => verdict(throughOwner, "read", row),
		],
		"trusted rules stored as JSON: build, then check one row": [
			1,
			post([posts[0]]),
			(row) => verdict(engine.fromJson(raw), "update", row),
		],
		...engine.only(blog, raw),
	};

	let sink = 0;

	const nanoseconds = (input, work) => {
		for (let index = 0; index < 500; index++) {
			sink += work(input());
		}

		const inputs = Array.from(
			{ length: Array.isArray(input()) ? 1 : BATCH },
			input,
		);

		globalThis.gc?.();

		let elapsed = 0n;
		let runs = 0;

		while (elapsed < SLICE_NS) {
			for (let index = 0; index < inputs.length; index++) {
				inputs[index] = input();
			}

			const started = process.hrtime.bigint();

			for (let index = 0; index < inputs.length; index++) {
				sink += work(inputs[index]);
			}

			elapsed += process.hrtime.bigint() - started;
			runs += inputs.length;
		}

		return Number(elapsed) / runs;
	};

	for (const [what, [expected, input, work]] of Object.entries(cases)) {
		for (let index = 0; index < TENANTS; index++) {
			const answer = work(input());

			if (answer !== expected) {
				throw new Error(`"${what}" answered ${answer}, expected ${expected}`);
			}
		}

		results[what] = nanoseconds(input, work);
	}

	console.log(JSON.stringify({ answers, results, sink }));
};

const compare = () => {
	const kinds = ["plain", "class"].flatMap((rows) =>
		["veto", "casl"].map((name) => `${name} ${rows}`),
	);
	const runs = Object.fromEntries(kinds.map((kind) => [kind, []]));

	for (let round = 0; round < ROUNDS; round++) {
		for (let turn = 0; turn < kinds.length; turn++) {
			const kind = kinds[(round + turn) % kinds.length];
			const [name, rows] = kind.split(" ");

			const child = spawnSync(
				process.execPath,
				["--expose-gc", fileURLToPath(import.meta.url)],
				{
					env: { ...process.env, BENCH_SIDE: name, BENCH_ROWS: rows },
					encoding: "utf8",
				},
			);

			if (child.status !== 0) {
				throw new Error(`${kind}: ${child.stderr}`);
			}

			runs[kind].push(JSON.parse(child.stdout));
		}

		process.stderr.write(`round ${round + 1}/${ROUNDS}\n`);
	}

	const reference = runs[kinds[0]][0].answers;

	for (const kind of kinds) {
		const disagreements = runs[kind][0].answers.flatMap((answer, index) =>
			answer === reference[index] ? [] : [index],
		);

		if (disagreements.length > 0) {
			throw new Error(
				`${kind} disagrees with ${kinds[0]} at answers ${disagreements}`,
			);
		}
	}

	const median = (values) => {
		const sorted = [...values].sort((a, b) => a - b);
		const middle = sorted.length >> 1;

		return sorted.length % 2 === 1
			? sorted[middle]
			: (sorted[middle - 1] + sorted[middle]) / 2;
	};

	const time = (ns) => {
		const us = ns / 1e3;

		if (us >= 1e3) {
			return `${(us / 1e3).toFixed(2)} ms`;
		}

		return `${us.toFixed(us >= 10 ? 0 : us >= 1 ? 1 : 2)} µs`;
	};

	const ratio = (veto, casl) =>
		casl >= veto
			? `veto ${(casl / veto).toFixed(1)}× faster`
			: `CASL ${(veto / casl).toFixed(1)}× faster`;

	const medianOf = (kind, what) =>
		median(runs[kind].map((out) => out.results[what]));

	console.log(
		`\n${reference.length} answers agree across both libraries and both row shapes. Median of ${ROUNDS} processes per library and row shape, ${process.version}.`,
	);

	const headings = {
		plain: "Rows are plain objects; CASL tags each one with subject().",
		class: "Rows are class instances; CASL reads the type from modelName.",
	};

	for (const rows of ["plain", "class"]) {
		console.log(`\n${headings[rows]}\n`);
		console.log("| | veto | CASL | |\n|---|---|---|---|");

		for (const what of Object.keys(runs[`casl ${rows}`][0].results)) {
			const [ns, other] = [
				medianOf(`veto ${rows}`, what),
				medianOf(`casl ${rows}`, what),
			];

			console.log(
				`| ${what} | ${time(ns)} | ${time(other)} | ${ratio(ns, other)} |`,
			);
		}
	}

	console.log("\nveto only, not compared with CASL.\n");
	console.log("| | veto |\n|---|---|");

	for (const what of Object.keys(runs["veto plain"][0].results)) {
		if (!(what in runs["casl plain"][0].results)) {
			console.log(`| ${what} | ${time(medianOf("veto plain", what))} |`);
		}
	}
};

await (side === undefined ? compare() : run());
