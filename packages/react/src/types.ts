import type {
	Ability,
	CheckedRule,
	DeclaredAction,
	EnvOf,
	ResourceMap,
	ResourceName,
	ShapeOf,
	withEnv,
} from "@vetojs/core";
import type { ReactNode } from "react";

/**
 * Props for the `<Can>` from {@link createVetoContext}, which reads the ability from the
 * surrounding provider.
 *
 * Pass `this` to ask about one row; leave it out to ask whether the action is possible at
 * all. `ability` overrides the provider for a subtree that needs a different actor.
 */
export type CanProps<AC extends ResourceMap, R extends ResourceName<AC>> = {
	I: DeclaredAction<AC, R>;
	a: R;
	this?: ShapeOf<AC, R>;
	ability?: Ability<AC>;
	children?: ReactNode;
	fallback?: ReactNode;
};

/**
 * Props for the `<Can>` from `@vetojs/react/server`, which takes the ability directly —
 * a server component has no provider above it and ships no context to the browser.
 */
export type ServerCanProps<
	AC extends ResourceMap,
	R extends ResourceName<AC>,
> = {
	ability: Ability<AC>;
	I: DeclaredAction<AC, R>;
	a: R;
	this?: ShapeOf<AC, R>;
	children?: ReactNode;
	fallback?: ReactNode;
};

type EnvProp<AC extends ResourceMap> = [EnvOf<AC>] extends [never]
	? { env?: never }
	: { env: EnvOf<AC> };

/**
 * Props for `AbilityProvider`: either the `rules` that arrived from the server, or an
 * `ability` you already built — never both, which the type enforces.
 *
 * When the declarations name an `env`, `rules` come with the `env` to bind them to. It is
 * compared key by key, so a literal written in the render does not rebind on every render,
 * and a change rebinds the rules — the ones set through `useSetRules` included.
 */
export type AbilityProviderProps<AC extends ResourceMap> = {
	children?: ReactNode;
} & (
	| ({ rules: readonly CheckedRule[]; ability?: never } & EnvProp<AC>)
	| { ability: Ability<AC>; rules?: never; env?: never }
);

export type EnvBinding<AC extends ResourceMap> = [EnvOf<AC>] extends [never]
	? []
	: [bind: typeof withEnv];

/**
 * What {@link createVetoContext} returns: the provider, the hooks and the `<Can>`
 * component, each narrowed to your resource declarations.
 */
export type VetoContext<AC extends ResourceMap> = {
	AbilityProvider: (props: AbilityProviderProps<AC>) => ReactNode;
	useAbility: () => Ability<AC>;
	/**
	 * One verdict, re-rendering only when that answer flips rather than whenever the rules
	 * change.
	 */
	useCan: <R extends ResourceName<AC>>(
		action: DeclaredAction<AC, R>,
		resource: R,
		row?: ShapeOf<AC, R>,
	) => boolean;
	useSetRules: () => (rules: readonly CheckedRule[]) => void;
	Can: <R extends ResourceName<AC>>(props: CanProps<AC, R>) => ReactNode;
};
