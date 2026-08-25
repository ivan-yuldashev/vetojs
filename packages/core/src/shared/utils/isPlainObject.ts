import type { Row } from "../types/row.js";

export const isPlainObject = <T extends Row>(value: unknown): value is T => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const proto = Object.getPrototypeOf(value);

	if (proto === null) {
		return true;
	}

	let baseProto = proto;
	while (Object.getPrototypeOf(baseProto) !== null) {
		baseProto = Object.getPrototypeOf(baseProto);
	}

	return proto === baseProto;
};
