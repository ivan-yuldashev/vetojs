type Owning<
	T,
	K extends PropertyKey,
	Owner = Extract<T, Record<K, unknown>>,
> = [Owner] extends [never] ? T : Owner;

export const owns = <T extends object, K extends PropertyKey>(
	node: T,
	key: K,
): node is Owning<T, K> => {
	return Object.hasOwn(node, key);
};
