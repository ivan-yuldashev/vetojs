import type { ConditionNode, Row } from "../model/index.js";

export const nothing = (): ConditionNode<Row> => ({ or: [] });

export const everything = (): ConditionNode<Row> => ({ and: [] });
