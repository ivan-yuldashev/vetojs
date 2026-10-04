import type { Ability, ResourceMap } from "@vetojs/core";

export type AbilityStore<AC extends ResourceMap> = {
	get: () => Ability<AC>;
	publish: (next: Ability<AC>) => void;
	subscribe: (listener: VoidFunction) => VoidFunction;
};

export const createAbilityStore = <AC extends ResourceMap>(
	initial: Ability<AC>,
): AbilityStore<AC> => {
	let current = initial;
	const listeners = new Set<VoidFunction>();

	return {
		get: () => current,
		publish: (next) => {
			if (next === current) {
				return;
			}

			current = next;

			for (const listener of [...listeners]) {
				listener();
			}
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};
