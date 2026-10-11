import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { createHash } from "node:crypto";
import {
  RawDocumentLakeRowSchema,
  type RawDocumentLakeRow,
} from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import type { StagingSource } from "#src/report-lake/staging/generations.ts";

export function rawDocumentRow(input: {
  kind: RawDocumentLakeRow["kind"];
  matchId: RiotMatchId;
  document: unknown;
  capturedAt: Date;
  source?: StagingSource;
}): RawDocumentLakeRow {
  const document: unknown = structuredClone(input.document);
  // The canonical spectator object is the existing capture authority. Its
  // credential is not an analytical field and must not be replicated into
  // the query lake, tool inspection, or sandbox datasets.
  if (
    document !== null &&
    typeof document === "object" &&
    !Array.isArray(document) &&
    input.kind === "prematch"
  )
    Reflect.deleteProperty(document, "observers");
  const json = JSON.stringify(document);
  return RawDocumentLakeRowSchema.parse({
    document_id: `${input.kind}:${input.matchId}`,
    match_id: input.matchId,
    kind: input.kind,
    captured_at: lakeTimestamp(input.capturedAt.getTime()),
    month: lakeMonth(input.capturedAt.getTime()),
    source_key: input.source?.kind === "s3" ? input.source.key : null,
    source_digest:
      input.source?.digest ?? createHash("sha256").update(json).digest("hex"),
    document_json: json,
  });
}
