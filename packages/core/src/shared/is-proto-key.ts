const PROTO_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

export const isProtoKey = (key: string): boolean => PROTO_KEYS.includes(key);
