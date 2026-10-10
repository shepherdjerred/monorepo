import type { ReportResultRow } from "#src/reports/query/query-types.ts";
import type { SandboxResultSchema } from "#src/explore/analysis/sandbox.ts";
import type { z } from "zod";

export const ANALYSIS_OUTPUT_BYTES = 8192;

/** Page complete values within the context budget, advancing by returned rows. */
export function jsonValuePage<T>(values: T[], offset: number): T[] {
  const page: T[] = [];
  for (const value of values.slice(offset, offset + 100)) {
    if (
      new TextEncoder().encode(JSON.stringify([...page, value])).byteLength >
      ANALYSIS_OUTPUT_BYTES
    ) {
      if (page.length === 0)
        throw new Error(
          "A selected value exceeds 8 KiB. Select scalar child fields instead of full participant or frame objects.",
        );
      break;
    }
    page.push(value);
  }
  return page;
}

/** Preserve canonical grouping keys and their display labels independently. */
export function queryDatasetRows(
  names: string[],
  rows: Pick<ReportResultRow, "keys" | "dimensions" | "values">[],
) {
  if (names.includes("__group_labels"))
    throw new Error("__group_labels is reserved for dataset display labels.");
  return rows.map((row) => {
    if (row.values.some((value) => value.column === "__group_labels"))
      throw new Error("__group_labels is reserved for dataset display labels.");
    if (
      row.keys.length !== names.length ||
      (names.length > 0 && row.dimensions.length !== names.length)
    )
      throw new Error("Query grouping keys and display labels must align.");
    return {
      ...Object.fromEntries(
        names.map((name, index) => [name, row.keys[index]]),
      ),
      ...Object.fromEntries(
        row.values.map(({ column, value }) => [column, value]),
      ),
      __group_labels: Object.fromEntries(
        names.map((name, index) => [name, row.dimensions[index]]),
      ),
    };
  });
}

/** Reject oversized responses explicitly; never silently truncate evidence. */
export function analysisOutputForModel(
  result: z.infer<typeof SandboxResultSchema>,
) {
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength <=
    ANALYSIS_OUTPUT_BYTES
  )
    return result;
  return {
    ok: false as const,
    message:
      "Analysis output exceeds 8 KiB. Return compact aggregates and selected events with identity labels; leave detailed records in the named datasets.",
  };
}
