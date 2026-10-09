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
  identityMap?: ReadonlyMap<string, string>;
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
    identity_map_json: documentIdentityMap(json, input.identityMap),
  });
}

function documentIdentityMap(
  json: string,
  identities: ReadonlyMap<string, string> | undefined,
): string {
  if (identities === undefined || identities.size === 0) return "{}";
  const present = new Map<string, string>();
  const include = (original: string): void => {
    const replacement = identities.get(original);
    if (replacement !== undefined) present.set(original, replacement);
  };
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      include(value);
    } else if (Array.isArray(value)) {
      for (const child of value) visit(child);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        include(key);
        visit(child);
      }
    }
  };
  // Traverse the serialized document so removed credentials, omitted fields,
  // and JSON conversions cannot introduce identities absent from the lake.
  // Lookup cost follows document size, independent of the full identity map.
  const document: unknown = JSON.parse(json);
  visit(document);
  return JSON.stringify(Object.fromEntries(present));
}
