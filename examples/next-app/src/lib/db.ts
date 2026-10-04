import { PGlite } from "@electric-sql/pglite";
import { defineTables } from "@vetojs/drizzle";
import {
	ac,
	blogs,
	comments,
	posts,
	users,
	workspaces,
} from "@vetojs-examples/shared";
import { eq, sql } from "drizzle-orm";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

export const workspacesTable = pgTable("workspaces", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	archived: boolean("archived").notNull(),
});
export const blogsTable = pgTable("blogs", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspacesTable.id),
	name: text("name").notNull(),
});
export const postsTable = pgTable("posts", {
	id: text("id").primaryKey(),
	blogId: text("blog_id")
		.notNull()
		.references(() => blogsTable.id),
	authorId: text("author_id")
		.notNull()
		.references(() => usersTable.id),
	status: text("status", { enum: ["draft", "published"] }).notNull(),
	title: text("title").notNull(),
	views: integer("views").notNull(),
	slug: text("slug").notNull(),
});
export const commentsTable = pgTable("comments", {
	id: text("id").primaryKey(),
	postId: text("post_id")
		.notNull()
		.references(() => postsTable.id),
	spam: boolean("spam").notNull(),
});
export const usersTable = pgTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
});

export const schema = defineTables(ac, {
	workspace: workspacesTable,
	blog: blogsTable,
	post: postsTable,
	comment: commentsTable,
	user: usersTable,
	analytics: null,
});

const seed = async (db: PgliteDatabase) => {
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

const store = globalThis as unknown as {
	__vetoDemoDb?: Promise<PgliteDatabase>;
};

export const getDb = (): Promise<PgliteDatabase> => {
	if (store.__vetoDemoDb === undefined) {
		store.__vetoDemoDb = (async () => {
			const db = drizzle(new PGlite());
			await seed(db);
			return db;
		})();
	}
	return store.__vetoDemoDb;
};

export const loadComposedPost = async (id: string) => {
	const db = await getDb();
	const [post] = await db
		.select()
		.from(postsTable)
		.where(eq(postsTable.id, id));
	if (post === undefined) {
		return undefined;
	}

	const [blog] = await db
		.select()
		.from(blogsTable)
		.where(eq(blogsTable.id, post.blogId));
	const [workspace] = blog
		? await db
				.select()
				.from(workspacesTable)
				.where(eq(workspacesTable.id, blog.workspaceId))
		: [];
	const [author] = await db
		.select()
		.from(usersTable)
		.where(eq(usersTable.id, post.authorId));
	const postComments = await db
		.select()
		.from(commentsTable)
		.where(eq(commentsTable.postId, id));

	return {
		...post,
		blog: blog ? { ...blog, workspace: workspace ?? null } : null,
		author: author ?? null,
		comments: postComments,
	};
};
