import { composedPosts, workspaces } from "@vetojs-examples/shared";
import { Link, Navigate, useParams } from "react-router";
import { Can, useAbility } from "./authz.js";

export const Forbidden = () => (
	<section className="card">
		<strong>403</strong>
		<p className="muted">
			The current actor is not allowed here. The nav link was hidden too — but
			hiding a link is UX, the route guards itself.
		</p>
	</section>
);

export const NotFound = () => (
	<section className="card">
		<strong>404</strong> <span className="muted">no such page</span>
	</section>
);

export const PostsPage = () => {
	const ability = useAbility();
	const visible = composedPosts.filter((post) =>
		ability.can("read", "post", post),
	);

	return (
		<section>
			<h2>Posts you can read ({visible.length})</h2>
			{visible.map((post) => (
				<article className="card" key={post.id}>
					<header>
						<span>
							<Link to={`/posts/${post.id}`}>
								<strong>{post.title}</strong>
							</Link>{" "}
							<span className="badge" data-status={post.status}>
								{post.status}
							</span>
						</span>
						<span className="actions">
							<Can I="update" a="post" this={post}>
								<Link to={`/posts/${post.id}/edit`}>edit</Link>
							</Can>
						</span>
					</header>
					<div className="muted">
						{post.blog?.name} · by {post.author?.name}
					</div>
				</article>
			))}
		</section>
	);
};

export const PostPage = () => {
	const { postId } = useParams();
	const ability = useAbility();
	const post = composedPosts.find((candidate) => candidate.id === postId);

	if (!post) {
		return <NotFound />;
	}
	if (!ability.can("read", "post", post)) {
		return <Forbidden />;
	}

	const visibleComments = post.comments.filter((comment) =>
		ability.can("read", "comment", comment),
	);

	return (
		<section>
			<h2>
				{post.title}{" "}
				<span className="badge" data-status={post.status}>
					{post.status}
				</span>
			</h2>
			<p className="muted">
				{post.blog?.name} · by {post.author?.name}
			</p>
			<p>
				<Can I="update" a="post" this={post}>
					<Link to={`/posts/${post.id}/edit`}>edit this post</Link>
				</Can>
			</p>
			<h2>Comments ({visibleComments.length})</h2>
			{visibleComments.map((comment) => (
				<div className="card" key={comment.id}>
					{comment.id}
				</div>
			))}
			<p>
				<Link to="/posts">← all posts</Link>
			</p>
		</section>
	);
};

export const PostEditPage = () => {
	const { postId } = useParams();
	const ability = useAbility();
	const post = composedPosts.find((candidate) => candidate.id === postId);

	if (!post) {
		return <NotFound />;
	}

	const writable = ability.permittedFields("update", "post", post, [
		"title",
		"status",
	]);

	return (
		<Can I="update" a="post" this={post} fallback={<Forbidden />}>
			<section>
				<h2>Edit “{post.title}”</h2>
				<div className="card">
					<label>
						title{" "}
						<input
							defaultValue={post.title}
							disabled={!writable.includes("title")}
						/>
					</label>
					<br />
					<label>
						status{" "}
						<input
							defaultValue={post.status}
							disabled={!writable.includes("status")}
						/>
					</label>
					<p className="muted">
						writable fields for this actor: {writable.join(", ") || "none"} —
						the payload gate is independent of row access.
					</p>
				</div>
				<p>
					<Link to={`/posts/${post.id}`}>← back</Link>
				</p>
			</section>
		</Can>
	);
};

export const AnalyticsPage = () => {
	const { workspaceId } = useParams();
	const workspace = workspaces.find(
		(candidate) => candidate.id === workspaceId,
	);

	if (!workspace || workspaceId === undefined) {
		return <NotFound />;
	}

	return (
		<Can I="view" a="analytics" fallback={<Forbidden />} this={{ workspaceId }}>
			<section>
				<h2>{workspace.name} — analytics</h2>
				<p className="muted">
					A phantom resource: no rows behind it, just a screen gated by the same
					policy (editors and admins of this workspace).
				</p>
			</section>
		</Can>
	);
};

export const WorkspaceSettingsPage = () => {
	const { workspaceId } = useParams();
	const ability = useAbility();
	const workspace = workspaces.find(
		(candidate) => candidate.id === workspaceId,
	);

	if (!workspace) {
		return <NotFound />;
	}
	if (ability.cannot("update", "workspace", workspace)) {
		return <Navigate replace to="/posts" />;
	}

	return (
		<section>
			<h2>{workspace.name} — settings</h2>
			<p className="muted">
				Only a workspace admin can see this page; everyone else is redirected.
			</p>
		</section>
	);
};
