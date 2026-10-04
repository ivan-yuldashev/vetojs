"use client";

import type { CheckedRules } from "@vetojs/core";
import { type PostShape, users } from "@vetojs-examples/shared";
import { useActionState, useState } from "react";
import { type UpdatePostState, updatePost } from "../lib/actions";
import { AbilityProvider, useAbility } from "../lib/veto";

const editable = ["title", "status", "authorId"] as const;

const Form = ({ post }: { post: PostShape }) => {
	const ability = useAbility();
	const [state, formAction] = useActionState<UpdatePostState, FormData>(
		updatePost,
		null,
	);
	const [draft, setDraft] = useState({
		title: post.title,
		status: post.status,
		authorId: post.authorId,
	});

	const writable = ability.permittedFields("update", "post", post, [
		...editable,
	]);

	const submitted = Object.fromEntries(
		writable.map((field) => [field, draft[field as keyof typeof draft]]),
	);

	const verdict = ability.validatePayload("update", "post", post, submitted);

	return (
		<div className="card">
			<p className="muted">
				The policy says these fields are writable here:{" "}
				<strong>{writable.join(", ") || "none"}</strong>. The form is drawn from
				that list, not from a hand-kept copy of it.
			</p>

			<form action={formAction}>
				<input name="id" type="hidden" value={post.id} />
				{writable.includes("title") && (
					<label>
						title{" "}
						<input
							name="title"
							onChange={(event) =>
								setDraft({ ...draft, title: event.target.value })
							}
							value={draft.title}
						/>
					</label>
				)}{" "}
				{writable.includes("status") && (
					<label>
						status{" "}
						<select
							name="status"
							onChange={(event) =>
								setDraft({
									...draft,
									status: event.target.value as PostShape["status"],
								})
							}
							value={draft.status}
						>
							<option value="draft">draft</option>
							<option value="published">published</option>
						</select>
					</label>
				)}{" "}
				{writable.includes("authorId") && (
					<label>
						author{" "}
						<select
							name="authorId"
							onChange={(event) =>
								setDraft({ ...draft, authorId: event.target.value })
							}
							value={draft.authorId}
						>
							{users.map((user) => (
								<option key={user.id} value={user.id}>
									{user.name}
								</option>
							))}
						</select>
					</label>
				)}{" "}
				<button disabled={!verdict.ok} type="submit">
					save
				</button>
			</form>

			{verdict.ok ? (
				<p className="muted">
					The browser checked this draft with the same rules the server will use
					— it passes, so the button is live.
				</p>
			) : (
				<p className="muted">
					Refused before anything was sent:{" "}
					<strong>
						{verdict.violations
							.map((violation) => `${violation.field}: ${violation.reason}`)
							.join("; ")}
					</strong>
					. Same call, same rules, same answer the server would give.
				</p>
			)}

			<form action={formAction}>
				<input name="id" type="hidden" value={post.id} />
				<input name="title" type="hidden" value={draft.title} />
				<input name="status" type="hidden" value="published" />
				<button type="submit">submit status=published anyway</button>
			</form>
			<p className="muted">
				That button skips the form and posts the value the UI just refused. The
				server runs the identical check and rejects it — which is the point:
				disabling a button is UX, the guard is the boundary.
			</p>

			{state && "issues" in state && (
				<p className="muted">
					the schema refused the result, and this is Zod's own wording:{" "}
					<strong>{state.issues.join("; ")}</strong>
				</p>
			)}
			{state && "error" in state && (
				<p className="muted">server rejected: {state.error}</p>
			)}
			{state && "ok" in state && <p className="muted">saved ✓</p>}
		</div>
	);
};

export const EditForm = ({
	post,
	rules,
}: {
	post: PostShape;
	rules: CheckedRules;
}) => (
	<AbilityProvider rules={rules}>
		<Form post={post} />
	</AbilityProvider>
);
