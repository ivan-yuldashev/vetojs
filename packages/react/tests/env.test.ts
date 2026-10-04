/** @vitest-environment jsdom */

import {
	type Ability,
	type CheckedRules,
	createRules,
	defineAbilities,
	shape,
	withEnv,
} from "@vetojs/core";
import { act, createElement, memo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVetoContext } from "../src/context.js";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Post = { id: string; authorId: string };
type Env = { hour: number; mfa: boolean };

const ac = defineAbilities({
	env: shape<Env>(),
	resources: { post: { schema: shape<Post>(), actions: ["read", "update"] } },
});
const plainAc = defineAbilities({
	resources: { post: { schema: shape<Post>(), actions: ["read"] } },
});

const { allow, deny } = createRules(ac);
const { AbilityProvider, Can, useAbility, useCan, useSetRules } =
	createVetoContext(ac, withEnv);

const NO_RULES: CheckedRules = [];
const policy: CheckedRules = [
	allow("read", "post", {
		when: { and: [{ hour: { gte: 9 } }, { hour: { lt: 18 } }] },
	}),
	allow("update", "post"),
	deny("update", "post", { when: { mfa: { ne: true } } }),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const render = (node: ReactNode) => act(() => root.render(node));

const gates = createElement(
	"span",
	null,
	createElement(Can, { I: "read", a: "post", fallback: "no-read " }, "read "),
	createElement(
		Can,
		{ I: "update", a: "post", fallback: "no-update" },
		"update",
	),
);

describe("a provider given an environment", () => {
	it("binds the rules to it, and again when it changes", () => {
		const tree = (env: Env) =>
			createElement(AbilityProvider, { rules: policy, env }, gates);

		render(tree({ hour: 10, mfa: true }));
		expect(container.textContent).toBe("read update");

		render(tree({ hour: 22, mfa: true }));
		expect(container.textContent).toBe("no-read update");

		render(tree({ hour: 10, mfa: false }));
		expect(container.textContent).toBe("read no-update");
	});

	it("keeps the binding while every key holds the same value", () => {
		const seen: Ability<typeof ac>[] = [];
		const Holder = () => {
			seen.push(useAbility());

			return null;
		};
		const tree = (hour: number) =>
			createElement(
				AbilityProvider,
				{ rules: policy, env: { hour, mfa: true } },
				createElement(Holder),
			);

		render(tree(10));
		render(tree(10));
		render(tree(11));

		expect(seen[1]).toBe(seen[0]);
		expect(seen.at(-1)).not.toBe(seen[0]);
	});

	it("binds the rules set later to the environment, and keeps them when it changes", () => {
		let setRules: (rules: CheckedRules) => void = () => {};
		const Setter = () => {
			setRules = useSetRules();

			return null;
		};
		const tree = (env: Env) =>
			createElement(
				AbilityProvider,
				{ rules: NO_RULES, env },
				createElement(Setter),
				gates,
			);

		render(tree({ hour: 10, mfa: true }));
		expect(container.textContent).toBe("no-read no-update");

		act(() => setRules(policy));
		expect(container.textContent).toBe("read update");

		render(tree({ hour: 22, mfa: true }));
		expect(container.textContent).toBe("no-read update");
	});

	it("binds new rules from the props to the environment it already has", () => {
		const env = { hour: 10, mfa: true };

		render(createElement(AbilityProvider, { rules: NO_RULES, env }, gates));
		expect(container.textContent).toBe("no-read no-update");

		render(createElement(AbilityProvider, { rules: policy, env }, gates));
		expect(container.textContent).toBe("read update");
	});

	it("binds rules set after a change of environment to the new one", () => {
		let setRules: (rules: CheckedRules) => void = () => {};
		const Setter = () => {
			setRules = useSetRules();

			return null;
		};
		const tree = (env: Env) =>
			createElement(
				AbilityProvider,
				{ rules: NO_RULES, env },
				createElement(Setter),
				gates,
			);

		render(tree({ hour: 10, mfa: true }));
		render(tree({ hour: 22, mfa: true }));
		act(() => setRules(policy));

		expect(container.textContent).toBe("no-read update");
	});

	it("re-renders a verdict only when the answer flips", () => {
		let renders = 0;
		const Verdict = memo(() => {
			renders++;

			return useCan("update", "post") ? "update" : "no-update";
		});
		const tree = (env: Env) =>
			createElement(
				AbilityProvider,
				{ rules: policy, env },
				createElement(Verdict),
			);

		render(tree({ hour: 10, mfa: true }));
		render(tree({ hour: 22, mfa: true }));
		expect(renders).toBe(1);

		render(tree({ hour: 22, mfa: false }));
		expect(renders).toBe(2);
		expect(container.textContent).toBe("no-update");
	});

	it("renders on the server in the environment it was given", () => {
		const html = renderToString(
			createElement(
				AbilityProvider,
				{ rules: policy, env: { hour: 10, mfa: false } },
				gates,
			),
		);

		expect(html).toContain("read");
		expect(html).toContain("no-update");
	});
});

describe("a provider with nothing to bind with", () => {
	it("lets no allow with when grant, and every deny with when stand", () => {
		const unbound = createVetoContext(ac as never) as unknown as ReturnType<
			typeof createVetoContext<typeof ac>
		>;

		render(
			createElement(
				unbound.AbilityProvider,
				{ rules: policy, env: { hour: 10, mfa: true } },
				createElement(
					unbound.Can,
					{ I: "read", a: "post", fallback: "no-read " },
					"read ",
				),
				createElement(
					unbound.Can,
					{ I: "update", a: "post", fallback: "no-update" },
					"update",
				),
			),
		);

		expect(container.textContent).toBe("no-read no-update");
	});

	it("reads no environment the props do not carry", () => {
		(Object.prototype as Record<string, unknown>).env = { hour: 10, mfa: true };

		try {
			render(createElement(AbilityProvider, { rules: policy } as never, gates));
			expect(container.textContent).toBe("no-read no-update");
		} finally {
			delete (Object.prototype as Record<string, unknown>).env;
		}
	});
});

describe("the types", () => {
	const bound = {} as Ability<typeof ac>;

	it("ask for withEnv and an environment exactly when the declarations name an env", () => {
		const written = () => [
			// @ts-expect-error the declarations name an env, so the bindings need withEnv
			createVetoContext(ac),
			// @ts-expect-error declarations without an env have nothing to bind
			createVetoContext(plainAc, withEnv),
			// @ts-expect-error rules come with the environment to bind them to
			createElement(AbilityProvider, { rules: policy }),
			// @ts-expect-error the environment names every key the declaration does
			createElement(AbilityProvider, { rules: policy, env: { hour: 10 } }),
			createElement(AbilityProvider, {
				ability: bound,
				// @ts-expect-error a built ability is bound already
				env: { hour: 1, mfa: true },
			}),
			createElement(createVetoContext(plainAc).AbilityProvider, {
				rules: [],
				// @ts-expect-error declarations without an env take no environment
				env: { hour: 10 },
			}),
		];

		expect(written).toBeTypeOf("function");
	});
});
