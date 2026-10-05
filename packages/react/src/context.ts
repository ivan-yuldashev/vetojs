"use client";

import type {
	Ability,
	CheckedRule,
	ResourceMap,
	ResourceName,
} from "@vetojs/core";
import { buildAbility } from "@vetojs/core";
import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { type AbilityStore, createAbilityStore } from "./store.js";
import type {
	AbilityProviderProps,
	CanProps,
	EnvBinding,
	VetoContext,
} from "./types.js";

const MISSING_ABILITY =
	"<Can> needs an ability: render it inside <AbilityProvider> or pass the `ability` prop";

const MISSING_PROVIDER = "useAbility must be used within <AbilityProvider>";

const neverNotifies = () => () => {};

const isReactNative =
	typeof navigator !== "undefined" && navigator.product === "ReactNative";

const useIsomorphicLayoutEffect =
	typeof document !== "undefined" || isReactNative
		? useLayoutEffect
		: useEffect;

/**
 * Creates React bindings that know your resources.
 *
 * A factory rather than a plain import, because typed bindings need your `ac` — the payoff
 * is that `<Can>` autocompletes actions per resource and rejects ones that do not exist.
 * Call it once in a module and import the bindings from there.
 *
 * When the declarations name an `env`, pass `withEnv` as well: the provider then binds the
 * rules to the `env` it is given. It is an argument rather than an import here so that an
 * app without an environment does not carry the code that binds one.
 *
 * @example
 * // src/veto.ts
 * export const { AbilityProvider, useAbility, useCan, Can } = createVetoContext(ac);
 */
export const createVetoContext = <AC extends ResourceMap>(
	ac: AC,
	...binding: EnvBinding<AC>
): VetoContext<AC> => {
	const [bind] = binding as [
		rebind?: (ability: Ability<AC>, env: unknown) => Ability<AC>,
	];
	const Context = createContext<AbilityStore<AC> | null>(null);

	const bound = (base: Ability<AC>, env: unknown): Ability<AC> => {
		return bind === undefined || env === undefined ? base : bind(base, env);
	};

	const AbilityProvider = (props: AbilityProviderProps<AC>) => {
		const { ability: prebuilt, rules } = props;
		const env = Object.hasOwn(props, "env") ? props.env : undefined;

		const base = useMemo(
			() => prebuilt ?? buildAbility(ac, rules ?? []),
			[prebuilt, rules],
		);

		const [store] = useState(() => {
			const created = createAbilityStore(bound(base, env));

			created.env = env;

			return created;
		});

		useIsomorphicLayoutEffect(() => {
			store.publish(bound(base, store.env));
		}, [store, base]);

		useIsomorphicLayoutEffect(() => {
			store.env = env;
			store.publish(bound(store.get(), env));
		}, [store, env]);

		return createElement(Context.Provider, { value: store }, props.children);
	};

	const useVerdict = (
		given: Ability<AC> | undefined,
		read: (ability: Ability<AC>) => boolean,
	): boolean => {
		const store = useContext(Context);

		const snapshot = () => {
			const ability = given ?? store?.get();

			if (ability === undefined) {
				throw new Error(MISSING_ABILITY);
			}

			return read(ability);
		};

		return useSyncExternalStore(
			given === undefined && store !== null ? store.subscribe : neverNotifies,
			snapshot,
			snapshot,
		);
	};

	const useStore = (): AbilityStore<AC> => {
		const store = useContext(Context);

		if (store === null) {
			throw new Error(MISSING_PROVIDER);
		}

		return store;
	};

	const useAbility = (): Ability<AC> => {
		const store = useStore();
		return useSyncExternalStore(store.subscribe, store.get, store.get);
	};

	const useSetRules = (): ((rules: readonly CheckedRule[]) => void) => {
		const store = useStore();

		return useCallback(
			(rules: readonly CheckedRule[]) =>
				store.publish(bound(buildAbility(ac, rules), store.env)),
			[store],
		);
	};

	const useCan: VetoContext<AC>["useCan"] = (action, resource, row?) => {
		return useVerdict(undefined, (ability) =>
			ability.can(action, resource, row),
		);
	};

	const Can = <R extends ResourceName<AC>>({
		I,
		a,
		this: row,
		ability: given,
		children,
		fallback = null,
	}: CanProps<AC, R>) => {
		return useVerdict(given, (ability) => ability.can(I, a, row))
			? children
			: fallback;
	};

	return { AbilityProvider, useAbility, useCan, useSetRules, Can };
};
