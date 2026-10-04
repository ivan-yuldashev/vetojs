import type { Blog, Comment, Post, User, Workspace } from "./model";
import type { Actor } from "./policy";

export const workspaces: Workspace[] = [
	{ id: "acme", name: "Acme", archived: false },
	{ id: "legacy", name: "Legacy", archived: true },
];

export const blogs: Blog[] = [
	{ id: "acme-eng", workspaceId: "acme", name: "Acme Engineering" },
	{ id: "legacy-news", workspaceId: "legacy", name: "Legacy News" },
];

export const users: User[] = [
	{ id: "alice", name: "Alice" },
	{ id: "bob", name: "Bob" },
	{ id: "carol", name: "Carol" },
];

export const posts: Post[] = [
	{
		id: "launch",
		blogId: "acme-eng",
		authorId: "bob",
		status: "published",
		title: "Launch day",
		views: 250,
		slug: "launch-day",
	},
	{
		id: "wip-notes",
		blogId: "acme-eng",
		authorId: "bob",
		status: "draft",
		title: "WIP notes",
		views: 300,
		slug: "wip-notes",
	},
	{
		id: "alice-draft",
		blogId: "acme-eng",
		authorId: "alice",
		status: "draft",
		title: "Alice's draft",
		views: 4,
		slug: "alices-draft",
	},
	{
		id: "old-announce",
		blogId: "legacy-news",
		authorId: "carol",
		status: "published",
		title: "Old announcement",
		views: 80,
		slug: "old-announcement",
	},
	{
		id: "old-draft",
		blogId: "legacy-news",
		authorId: "carol",
		status: "draft",
		title: "Never finished",
		views: 0,
		slug: "never-finished",
	},
];

export const comments: Comment[] = [
	{ id: "c-nice", postId: "launch", spam: false },
	{ id: "c-viagra", postId: "launch", spam: true },
	{ id: "c-old", postId: "old-announce", spam: false },
];

export const actors = {
	alice: { id: "alice", memberships: [{ workspaceId: "acme", role: "admin" }] },
	bob: { id: "bob", memberships: [{ workspaceId: "acme", role: "editor" }] },
	carol: {
		id: "carol",
		memberships: [
			{ workspaceId: "acme", role: "viewer" },
			{ workspaceId: "legacy", role: "editor" },
		],
	},
} satisfies Record<string, Actor>;

const workspacesById = new Map(
	workspaces.map((workspace) => [workspace.id, workspace]),
);
const usersById = new Map(users.map((user) => [user.id, user]));
const composedBlogs = blogs.map((blog) => ({
	...blog,
	workspace: workspacesById.get(blog.workspaceId) ?? null,
}));
const blogsById = new Map(composedBlogs.map((blog) => [blog.id, blog]));

export const composedPosts = posts.map((post) => ({
	...post,
	blog: blogsById.get(post.blogId) ?? null,
	author: usersById.get(post.authorId) ?? null,
	comments: comments.filter((comment) => comment.postId === post.id),
}));
