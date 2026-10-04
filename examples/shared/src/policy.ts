import { type CheckedRules, createRules } from "@vetojs/core";
import { ac } from "./model";

export type Role = "viewer" | "editor" | "admin";

export type Actor = {
	id: string;
	memberships: { workspaceId: string; role: Role }[];
};

const { allow, deny } = createRules(ac);

export const policyFor = (actor: Actor): CheckedRules => {
	const workspacesWhere = (...roles: Role[]) =>
		actor.memberships
			.filter((membership) => roles.includes(membership.role))
			.map((membership) => membership.workspaceId);

	const member = workspacesWhere("viewer", "editor", "admin");
	const writer = workspacesWhere("editor", "admin");
	const admin = workspacesWhere("admin");

	const rules: CheckedRules = [];

	if (member.length > 0) {
		rules.push(
			allow("read", "workspace", { where: { id: { in: member } } }),
			allow("read", "blog", { where: { workspace: { id: { in: member } } } }),
			allow("read", "post", {
				where: {
					status: "published",
					blog: { workspace: { id: { in: member } } },
				},
			}),
			allow("read", "post", {
				where: {
					views: { gte: 100 },
					blog: { workspace: { id: { in: member } } },
				},
			}),
		);
	}

	if (writer.length > 0) {
		rules.push(
			allow("view", "analytics", { where: { workspaceId: { in: writer } } }),
			allow("read", "post", {
				where: { blog: { workspace: { id: { in: writer } } } },
			}),
			allow(
				["update", "publish"],
				{ post: ["title", "status"] },
				{
					where: {
						authorId: actor.id,
						blog: { workspace: { id: { in: writer } } },
					},
					values: { status: { in: ["draft"] } },
				},
			),
		);
	}

	if (admin.length > 0) {
		rules.push(
			allow("manage", "post", {
				where: { blog: { workspace: { id: { in: admin } } } },
			}),
			allow("update", "workspace", { where: { id: { in: admin } } }),
		);
	}

	return [
		...rules,
		allow("read", "comment"),
		deny("read", "comment", { where: { spam: true } }),
		deny(["update", "publish", "delete"], "post", {
			where: { blog: { workspace: { archived: true } } },
		}),
		deny(["update", "publish"], "post", {
			where: { comments: { some: { spam: true } } },
		}),
	];
};
