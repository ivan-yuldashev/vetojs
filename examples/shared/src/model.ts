import { defineAbilities, type ShapeOf, shape } from "@vetojs/core";
import { z } from "zod";

export type Workspace = {
	id: string;
	name: string;
	archived: boolean;
};

export type Blog = {
	id: string;
	workspaceId: string;
	name: string;
};

export const postSchema = z.object({
	id: z.string(),
	blogId: z.string(),
	authorId: z.string(),
	status: z.enum(["draft", "published"]),
	title: z.string().min(3, "a title needs at least 3 characters"),
	views: z.number(),
	slug: z.string(),
});

export type Post = z.infer<typeof postSchema>;

export type Comment = {
	id: string;
	postId: string;
	spam: boolean;
};

export type User = {
	id: string;
	name: string;
};

export const ac = defineAbilities({
	resources: {
		workspace: {
			schema: shape<Workspace>(),
			actions: ["read", "update"],
		},
		blog: {
			schema: shape<Blog>(),
			actions: ["read"],
			relations: {
				workspace: { resource: "workspace", kind: "one" },
			},
		},
		post: {
			schema: postSchema,
			actions: ["read", "update", "publish", "delete"],
			relations: {
				blog: { resource: "blog", kind: "one" },
				author: { resource: "user", kind: "one" },
				comments: { resource: "comment", kind: "many" },
			},
		},
		comment: {
			schema: shape<Comment>(),
			actions: ["read", "delete"],
		},
		user: {
			schema: shape<User>(),
			actions: ["read"],
		},
		analytics: {
			schema: shape<{ workspaceId: string }>(),
			actions: ["view"],
		},
	},
});

export type AC = typeof ac;
export type PostShape = ShapeOf<AC, "post">;
