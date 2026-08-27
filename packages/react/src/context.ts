"use client";

import type {
	AbilitySet,
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
	UseCan,
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
 * @example
 * // src/veto.ts
 * export const { AbilityProvider, useAbility, useCan, Can } = createVetoContext(ac);
 */
export const createVetoContext = <AC extends ResourceMap>(
	ac: AC,
): VetoContext<AC> => {
	const Context = createContext<AbilityStore<AC> | null>(null);

	const AbilityProvider = (props: AbilityProviderProps<AC>) => {
		const { ability: prebuilt, rules } = props;

		const ability = useMemo(
			() => prebuilt ?? buildAbility(ac, rules ?? []),
			[prebuilt, rules],
		);

		const [store] = useState(() => createAbilityStore(ability));

		useIsomorphicLayoutEffect(() => {
			store.publish(ability);
		}, [store, ability]);

		return createElement(Context.Provider, { value: store }, props.children);
	};

	const useVerdict = (
		given: AbilitySet<AC> | undefined,
		read: (ability: AbilitySet<AC>) => boolean,
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

	const useAbility = (): AbilitySet<AC> => {
		const store = useStore();
		return useSyncExternalStore(store.subscribe, store.get, store.get);
	};

	const useSetRules = (): ((rules: readonly CheckedRule[]) => void) => {
		const store = useStore();

		return useCallback(
			(rules: readonly CheckedRule[]) => store.publish(buildAbility(ac, rules)),
			[store],
		);
	};

	const useCan: UseCan<AC> = (action, resource, instance?) => {
		return useVerdict(undefined, (ability) =>
			ability.can(action, resource, instance),
		);
	};

	const Can = <R extends ResourceName<AC>>({
		I,
		a,
		this: instance,
		ability: given,
		children,
		fallback = null,
	}: CanProps<AC, R>) => {
		return useVerdict(given, (ability) => ability.can(I, a, instance))
			? children
			: fallback;
	};

	return { AbilityProvider, useAbility, useCan, useSetRules, Can };
};
