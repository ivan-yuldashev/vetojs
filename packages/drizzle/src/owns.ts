type Owning<T, K extends PropertyKey> = [
	Extract<T, Record<K, unknown>>,
] extends [never]
	? T
	: Extract<T, Record<K, unknown>>;

export const owns = <T extends object, K extends PropertyKey>(
	node: T,
	key: K,
): node is Owning<T, K> => Object.hasOwn(node, key);
