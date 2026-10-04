import type { Row } from "../model/index.js";

export type Verdict = boolean | undefined;

export type Matcher = (row: Row) => Verdict;
