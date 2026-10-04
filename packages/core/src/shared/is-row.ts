import type { Row } from "../model/index.js";
import { isPlainObject } from "./is-plain-object.js";

export const isRow = (value: unknown): value is Row => {
	return isPlainObject(value);
};
