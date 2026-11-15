/**
 * The shape every lake relation is built as: SQL text plus its bound
 * parameters. Kept apart from lake.ts so the modules lake.ts composes (the
 * crawl union) can name it without importing lake.ts back.
 */
export type LakeBoundParam =
  | { kind: "scalar"; value: string | number | boolean }
  | { kind: "list"; values: string[] | number[] };

export type LakeSqlFragment = {
  sql: string;
  params: LakeBoundParam[];
};
