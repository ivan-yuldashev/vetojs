import type {
	AbilitySet,
	ActionFor,
	CheckedRule,
	ResourceMap,
	ResourceName,
	ShapeOf,
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
	I: ActionFor<AC, R>;
	a: R;
	this?: ShapeOf<AC, R>;
	ability?: AbilitySet<AC>;
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
	ability: AbilitySet<AC>;
	I: ActionFor<AC, R>;
	a: R;
	this?: ShapeOf<AC, R>;
	children?: ReactNode;
	fallback?: ReactNode;
};

/**
 * Props for `AbilityProvider`: either the `rules` that arrived from the server, or an
 * `ability` you already built — never both, which the type enforces.
 */
export type AbilityProviderProps<AC extends ResourceMap> = {
	children?: ReactNode;
} & (
	| { rules: readonly CheckedRule[]; ability?: never }
	| { ability: AbilitySet<AC>; rules?: never }
);

/**
 * The `useCan` hook: one verdict, re-rendering only when that answer flips rather than
 * whenever the rules change.
 */
export type UseCan<AC extends ResourceMap> = <R extends ResourceName<AC>>(
	action: ActionFor<AC, R>,
	resource: R,
	instance?: ShapeOf<AC, R>,
) => boolean;

/**
 * What {@link createVetoContext} returns: the provider, the hooks and the `<Can>`
 * component, each narrowed to your resource declarations.
 */
export type VetoContext<AC extends ResourceMap> = {
	AbilityProvider: (props: AbilityProviderProps<AC>) => ReactNode;
	useAbility: () => AbilitySet<AC>;
	useCan: UseCan<AC>;
	useSetRules: () => (rules: readonly CheckedRule[]) => void;
	Can: <R extends ResourceName<AC>>(props: CanProps<AC, R>) => ReactNode;
};
