import { PGlite } from "@electric-sql/pglite";
import { buildAbility, markLoaded } from "@vetojs/core";
import { defineTables } from "@vetojs/drizzle";
import {
	ac,
	actors,
	blogs,
	comments,
	composedPosts,
	policyFor,
	posts,
	users,
	workspaces,
} from "@vetojs-examples/shared";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";

const databaseUrl = process.env.DATABASE_URL;
const db = databaseUrl
	? drizzleNodePg(databaseUrl)
	: drizzlePglite(new PGlite());

console.log(
	databaseUrl
		? `Postgres: ${databaseUrl.replace(/\/\/.*@/, "//***@")}`
		: "Postgres: in-memory PGlite (set DATABASE_URL for a real server)",
);

const workspacesTable = pgTable("workspaces", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	archived: boolean("archived").notNull(),
});
const blogsTable = pgTable("blogs", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspacesTable.id),
	name: text("name").notNull(),
});
const postsTable = pgTable("posts", {
	id: text("id").primaryKey(),
	blogId: text("blog_id")
		.notNull()
		.references(() => blogsTable.id),
	authorId: text("author_id")
		.notNull()
		.references(() => usersTable.id),
	status: text("status").notNull(),
	title: text("title").notNull(),
	views: integer("views").notNull(),
	slug: text("slug").notNull(),
});
const commentsTable = pgTable("comments", {
	id: text("id").primaryKey(),
	postId: text("post_id")
		.notNull()
		.references(() => postsTable.id),
	spam: boolean("spam").notNull(),
});
const usersTable = pgTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
});

const schema = defineTables(ac, {
	workspace: workspacesTable,
	blog: blogsTable,
	post: postsTable,
	comment: commentsTable,
	user: usersTable,
	analytics: null,
});

const seed = async () => {
	await db.execute(
		sql`drop table if exists workspaces, blogs, posts, comments, users`,
	);
	await db.execute(sql`
		create table workspaces (id text primary key, name text not null, archived boolean not null);
	`);
	await db.execute(sql`
		create table blogs (id text primary key, workspace_id text not null, name text not null);
	`);
	await db.execute(sql`
		create table posts (
			id text primary key, blog_id text not null, author_id text not null,
			status text not null, title text not null, views integer not null
		);
	`);
	await db.execute(sql`
		create table comments (id text primary key, post_id text not null, spam boolean not null);
	`);
	await db.execute(
		sql`create table users (id text primary key, name text not null);`,
	);

	await db.insert(workspacesTable).values(workspaces);
	await db.insert(blogsTable).values(blogs);
	await db.insert(postsTable).values(posts);
	await db.insert(commentsTable).values(comments);
	await db.insert(usersTable).values(users);
};

type Row = {
	actor: string;
	action: string;
	"can() rows": string;
	"SQL rows": string;
	match: string;
};

const main = async () => {
	await seed();

	const report: Row[] = [];
	let mismatches = 0;

	for (const [name, actor] of Object.entries(actors)) {
		const ability = buildAbility(ac, policyFor(actor));

		for (const action of ["read", "update"] as const) {
			const engineVisible = composedPosts
				.filter((post) => ability.can(action, "post", post))
				.map((post) => post.id)
				.sort();

			const filter = schema.filter(ability, action, "post");
			const selected = await db
				.select({ id: postsTable.id })
				.from(postsTable)
				.where(filter);
			const sqlVisible = selected.map((row) => row.id).sort();

			const match =
				JSON.stringify(engineVisible) === JSON.stringify(sqlVisible);
			if (!match) {
				mismatches += 1;
			}

			report.push({
				actor: name,
				action,
				"can() rows": engineVisible.join(", ") || "—",
				"SQL rows": sqlVisible.join(", ") || "—",
				match: match ? "✓" : "✗ MISMATCH",
			});
		}
	}

	console.log(
		"\nOne policy, two enforcement paths — post visibility per actor:\n",
	);
	console.table(report);

	const bob = buildAbility(ac, policyFor(actors.bob));
	const own = composedPosts.find((post) => post.id === "wip-notes");
	if (own) {
		console.log("payload gate — bob updates his own draft:");
		console.log(
			'  { title: "Better title" }  →',
			JSON.stringify(
				bob.validatePayload("update", "post", own, { title: "Better title" }),
			),
		);
		console.log(
			'  { status: "draft" }        →',
			JSON.stringify(
				bob.validatePayload("update", "post", own, { status: "draft" }),
			),
		);
		console.log(
			'  { status: "published" }    →',
			JSON.stringify(
				bob.validatePayload("update", "post", own, { status: "published" }),
			),
		);
	}

	console.log("\nfail-closed safety:");

	const bareRow = posts.find((post) => post.id === "launch");
	if (bareRow) {
		try {
			bob.can("read", "post", bareRow);
			console.log("  bare row (no relations) → UNEXPECTEDLY did not throw");
		} catch (error) {
			const name = error instanceof Error ? error.constructor.name : "unknown";
			console.log(
				`  can() on a row without a loaded relation → throws ${name}`,
			);
		}

		const emptied = markLoaded(bareRow, "blog", null);
		console.log(
			`  markLoaded(row, "blog", null) then can("read") → ${bob.can("read", "post", emptied)} (decidable, no throw)`,
		);
	}

	const forbidden = composedPosts.find((post) => post.id === "old-draft");
	if (forbidden) {
		try {
			bob.authorize("read", "post", forbidden);
			console.log("  authorize on a forbidden row → UNEXPECTEDLY passed");
		} catch (error) {
			const message = error instanceof Error ? error.message : "unknown";
			console.log(`  authorize() on a forbidden row → throws: ${message}`);
		}
	}

	if (mismatches > 0) {
		console.error(`\n${mismatches} mismatch(es) — can() and SQL disagree!`);
		process.exitCode = 1;
	} else {
		console.log("\nAll sets match — can() and SQL agree on every row. ✓");
	}
};

await main();
process.exit();
