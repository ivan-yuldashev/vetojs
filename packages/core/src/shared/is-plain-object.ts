import type { Row } from "../model/index.js";
import { owns } from "./owns.js";

export const isPlainObject = <T extends Row>(value: unknown): value is T => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const maker: unknown = value.constructor;

	if (typeof maker !== "function") {
		return true;
	}

	const proto: unknown = maker.prototype;

	if (typeof proto !== "object" || proto === null) {
		return false;
	}

	return owns(proto, "isPrototypeOf");
};
