import { z } from "zod";
import { MovieEditionScopeSchema, type MovieEditionScope } from "./registry.ts";

/** A new scoped warning body; historical unscoped warning payloads stay literal. */
export const MovieRetentionWarningV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  kind: z.literal("movie_retention_warning"),
  scope: MovieEditionScopeSchema,
  decisionId: z.uuid(),
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
});
export const MovieRetentionResultV4Schema = z.strictObject({
  status: z.enum([
    "protected",
    "warning",
    "grace",
    "quarantine",
    "purge",
    "complete",
    "obsolete",
  ]),
  decisionId: z.uuid().nullable(),
  wakeAt: z.iso.datetime().nullable(),
  reason: z.string().nullable(),
});
export type MovieRetentionResultV4 = z.infer<
  typeof MovieRetentionResultV4Schema
>;

export function readMovieRetentionWarningV4(raw: unknown) {
  const header = z.object({ kind: z.string().optional() }).parse(raw);
  return header.kind === "movie_retention_warning"
    ? MovieRetentionWarningV4Schema.parse(raw)
    : null;
}

/** The original warning event and exact selected binding must still match its decision. */
export function movieRetentionWarningMatches(
  warning: z.infer<typeof MovieRetentionWarningV4Schema>,
  current: {
    recoveryEpoch: number;
    eventId: string;
    decision: { mediaId: string; evidence: unknown };
    scope: MovieEditionScope | undefined;
  },
) {
  const evidence = z
    .object({ warningEventId: z.string() })
    .parse(current.decision.evidence);
  return (
    warning.recoveryEpoch === current.recoveryEpoch &&
    warning.scope.mediaId === current.decision.mediaId &&
    warning.scope.rootMediaId === current.decision.mediaId &&
    evidence.warningEventId === current.eventId &&
    current.scope?.edition === warning.scope.edition
  );
}
