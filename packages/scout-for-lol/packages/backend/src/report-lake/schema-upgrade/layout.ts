import { z } from "zod";
import {
  RAW_DOCUMENT_LAKE_COLUMNS,
  RawDocumentLakeRowSchema,
  type RawDocumentLakeRow,
} from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";
import {
  MATCH_LAKE_COLUMNS,
  lakeSchemaFingerprint,
} from "#src/report-lake/schema.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { readBuildFingerprint } from "#src/report-lake/build-manifest.ts";

/** Temporary compatibility until both hosted lakes drop the retired column. */
const LEGACY_RAW_DOCUMENT_COLUMNS = {
  ...RAW_DOCUMENT_LAKE_COLUMNS,
  identity_map_json: "VARCHAR",
} as const;

export type ReportLakeLayout =
  "current" | "legacy-identity-map" | "legacy-identity-map-pre-data-source";

/** Temporary wire compatibility for pre-bridge readers during mixed waves. */
export function bridgeRawDocumentRow(row: RawDocumentLakeRow) {
  return { ...row, identity_map_json: "{}" };
}

/** Stop emitting the wire bridge once the atomic schema handoff completes. */
export async function bridgeRawDocumentStagingRow(
  lakeDir: string,
  row: RawDocumentLakeRow,
): Promise<RawDocumentLakeRow> {
  const current = await readCurrentBuildDir(lakeDir);
  if (current === undefined) return bridgeRawDocumentRow(row);
  const layout = reportLakeLayout(await readBuildFingerprint(current));
  if (layout === undefined)
    throw new Error(
      "Cannot stage raw documents against an unknown lake schema",
    );
  return layout === "current" ? row : bridgeRawDocumentRow(row);
}

export function rawDocumentColumns(layout: ReportLakeLayout) {
  return layout === "current"
    ? RAW_DOCUMENT_LAKE_COLUMNS
    : LEGACY_RAW_DOCUMENT_COLUMNS;
}

export function matchColumns(layout: ReportLakeLayout) {
  if (layout !== "legacy-identity-map-pre-data-source")
    return MATCH_LAKE_COLUMNS;
  const { data_source: _retired, ...columns } = MATCH_LAKE_COLUMNS;
  return columns;
}

export function layoutFingerprint(layout: ReportLakeLayout): string {
  return lakeSchemaFingerprint(
    rawDocumentColumns(layout),
    matchColumns(layout),
  );
}

export function reportLakeLayout(
  fingerprint: string | undefined,
): ReportLakeLayout | undefined {
  if (fingerprint === layoutFingerprint("current")) return "current";
  if (fingerprint === layoutFingerprint("legacy-identity-map"))
    return "legacy-identity-map";
  return fingerprint ===
    layoutFingerprint("legacy-identity-map-pre-data-source")
    ? "legacy-identity-map-pre-data-source"
    : undefined;
}

// Only the known retired field is accepted, never arbitrary extra columns.
// It is discarded; neither its contents nor archived maps translate identities.
export const BridgeRawDocumentLakeRowSchema = RawDocumentLakeRowSchema.extend({
  identity_map_json: z.string().optional(),
}).transform(({ identity_map_json: _retired, ...row }) => row);
