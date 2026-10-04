import { parseRules } from "@vetojs/core";
import { actors, policyFor, workspaces } from "@vetojs-examples/shared";
import { useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { AbilityProvider, Can, useSetRules } from "./authz.js";
import {
	AnalyticsPage,
	NotFound,
	PostEditPage,
	PostPage,
	PostsPage,
	WorkspaceSettingsPage,
} from "./pages.js";

type ActorName = keyof typeof actors;
const actorNames = Object.keys(actors) as ActorName[];

const tamperedRule = {
	effect: "allow",
	action: "delete",
	resource: "workspace",
	where: { field: "id", op: "sudo", value: 1 },
};

const tampered = parseRules([tamperedRule]);

const roleLabel: Record<ActorName, string> = {
	alice: "alice — admin of Acme",
	bob: "bob — editor of Acme",
	carol: "carol — viewer of Acme, editor of archived Legacy",
};

const wireFor = (name: ActorName) =>
	JSON.stringify(policyFor(actors[name]), null, 2);

const parseFor = (name: ActorName) => {
	const json = wireFor(name);
	const parsed = parseRules(JSON.parse(json));
	return { json, parsed };
};

const initial = parseFor("carol");

const Nav = () => (
	<nav className="actions">
		<Link to="/posts">posts</Link>
		{workspaces.map((workspace) => (
			<Can I="update" a="workspace" key={workspace.id} this={workspace}>
				{" · "}
				<Link to={`/workspaces/${workspace.id}/settings`}>
					{workspace.name} settings
				</Link>
			</Can>
		))}
		{workspaces.map((workspace) => (
			<Can
				I="view"
				a="analytics"
				key={workspace.id}
				this={{ workspaceId: workspace.id }}
			>
				{" · "}
				<Link to={`/workspaces/${workspace.id}/analytics`}>
					{workspace.name} analytics
				</Link>
			</Can>
		))}
	</nav>
);

const ActorSwitch = () => {
	const setRules = useSetRules();
	const [view, setView] = useState({ name: "carol" as ActorName, ...initial });

	const switchTo = (name: ActorName) => {
		const next = parseFor(name);

		if (next.parsed.ok) {
			setRules(next.parsed.rules);
		}

		setView({ name, ...next });
	};

	return (
		<>
			<div className="actor-switch">
				{actorNames.map((name) => (
					<button
						data-active={name === view.name}
						key={name}
						onClick={() => switchTo(name)}
						type="button"
					>
						{name}
					</button>
				))}
			</div>
			<p className="muted">{roleLabel[view.name]}</p>

			{!tampered.ok && (
				<p className="muted">
					the trust boundary refused a tampered batch:{" "}
					{tampered.errors.join(" · ")} — one rule the gate cannot read and the
					whole delivery is turned away, so nothing half-understood reaches the
					engine.
				</p>
			)}

			<details>
				<summary className="muted">
					rules JSON as delivered to the client
				</summary>
				<pre>{view.json}</pre>
			</details>
		</>
	);
};

export const App = () => {
	if (!initial.parsed.ok) {
		return <pre>rule JSON rejected: {initial.parsed.errors.join("\n")}</pre>;
	}

	return (
		<BrowserRouter>
			<main>
				<h1>@vetojs — one policy, gated UI and routes</h1>

				<AbilityProvider rules={initial.parsed.rules}>
					<ActorSwitch />
					<Nav />
					<Routes>
						<Route element={<Navigate replace to="/posts" />} path="/" />
						<Route element={<PostsPage />} path="/posts" />
						<Route element={<PostPage />} path="/posts/:postId" />
						<Route element={<PostEditPage />} path="/posts/:postId/edit" />
						<Route
							element={<WorkspaceSettingsPage />}
							path="/workspaces/:workspaceId/settings"
						/>
						<Route
							element={<AnalyticsPage />}
							path="/workspaces/:workspaceId/analytics"
						/>
						<Route element={<NotFound />} path="*" />
					</Routes>
				</AbilityProvider>
			</main>
		</BrowserRouter>
	);
};
