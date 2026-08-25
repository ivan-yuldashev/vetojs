import {
	buildAbility,
	type CheckedRules,
	createRules,
	markLoaded,
} from "@vetojs/core";
import { type Actor, ac, policyFor } from "@vetojs-examples/shared";

const { allow, deny } = createRules(ac);

const WORKSPACES = 50;

const actor: Actor = {
	id: "u1",
	memberships: Array.from({ length: WORKSPACES }, (_, index) => ({
		workspaceId: `w${index}`,
		role: index % 3 === 0 ? "admin" : index % 3 === 1 ? "editor" : "viewer",
	})),
};

const perTenant = (who: Actor): CheckedRules => {
	const rules: CheckedRules = [];

	for (const { workspaceId, role } of who.memberships) {
		rules.push(
			allow("read", "workspace", { where: { id: workspaceId } }),
			allow("read", "blog", { where: { workspace: { id: workspaceId } } }),
			allow("read", "post", {
				where: {
					status: "published",
					blog: { workspace: { id: workspaceId } },
				},
			}),
			allow("read", "post", {
				where: {
					views: { gte: 100 },
					blog: { workspace: { id: workspaceId } },
				},
			}),
		);

		if (role !== "viewer") {
			rules.push(
				allow("view", "analytics", { where: { workspaceId } }),
				allow("read", "post", {
					where: { blog: { workspace: { id: workspaceId } } },
				}),
				allow(["update", "publish"], "post", {
					where: {
						authorId: who.id,
						blog: { workspace: { id: workspaceId } },
					},
					payload: {
						fields: ["title", "status"],
						constraints: { status: { in: ["draft"] } },
					},
				}),
			);
		}

		if (role === "admin") {
			rules.push(
				allow("manage", "post", {
					where: { blog: { workspace: { id: workspaceId } } },
				}),
				allow("update", "workspace", { where: { id: workspaceId } }),
			);
		}
	}

	rules.push(
		allow("read", "comment"),
		deny("read", "comment", { where: { spam: true } }),
	);

	return rules;
};

const grouped = policyFor(actor);
const perWorkspace = perTenant(actor);

const workspace = { id: "w1", name: "Acme", archived: false };
const blog = markLoaded(
	{ id: "b1", workspaceId: "w1", name: "b" },
	"workspace",
	workspace,
);
const post = markLoaded(
	{
		id: "p1",
		blogId: "b1",
		authorId: "u1",
		title: "probe",
		status: "published" as const,
		views: 10,
	},
	"blog",
	blog,
);

const microseconds = (run: () => void): number => {
	for (let i = 0; i < 200; i++) {
		run();
	}

	const started = process.hrtime.bigint();
	let iterations = 0;

	while (Number(process.hrtime.bigint() - started) < 5e8) {
		run();
		iterations++;
	}

	return Number(process.hrtime.bigint() - started) / 1000 / iterations;
};

const report = (label: string, rules: CheckedRules) => {
	const ability = buildAbility(ac, rules);
	const bytes = JSON.stringify(rules).length;
	const each = microseconds(() => {
		ability.can("read", "post", post);
	});

	console.log(
		`${label.padEnd(22)} ${String(rules.length).padStart(4)} rules   ${(bytes / 1000).toFixed(1)} kB JSON   can() ${each.toFixed(2)} µs`,
	);
};

console.log(`An actor with ${WORKSPACES} memberships, roles mixed.\n`);
report("one rule per workspace", perWorkspace);
report("grouped by role", grouped);
