import { ReportAiFinalDraftWireSchema } from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extend the wire-level draft contract with ScoutQL semantics so malformed
 * queries are repaired by the safe, tool-free structured finalizer instead of
 * failing only after its retry budget has been discarded.
 */
export const ValidatedReportAiFinalDraftSchema =
  ReportAiFinalDraftWireSchema.superRefine((draft, context) => {
    try {
      compileScoutQl(draft.queryText);
    } catch (error: unknown) {
      context.addIssue({
        code: "custom",
        path: ["queryText"],
        message: `ScoutQL validation failed: ${errorMessage(error)}`,
      });
    }
  });
