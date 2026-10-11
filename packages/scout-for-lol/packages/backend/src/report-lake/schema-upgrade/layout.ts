import { z } from "zod";
import {
  RAW_DOCUMENT_LAKE_COLUMNS,
  RawDocumentLakeRowSchema,
} from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";

/** Temporary compatibility until both hosted lakes drop the retired column. */
const LEGACY_RAW_DOCUMENT_COLUMNS = {
  ...RAW_DOCUMENT_LAKE_COLUMNS,
  identity_map_json: "VARCHAR",
} as const;

export type ReportLakeLayout = "current" | "legacy-identity-map";

export function rawDocumentColumns(layout: ReportLakeLayout) {
  return layout === "current"
    ? RAW_DOCUMENT_LAKE_COLUMNS
    : LEGACY_RAW_DOCUMENT_COLUMNS;
}

export function layoutFingerprint(layout: ReportLakeLayout): string {
  return lakeSchemaFingerprint(rawDocumentColumns(layout));
}

export function reportLakeLayout(
  fingerprint: string | undefined,
): ReportLakeLayout | undefined {
  if (fingerprint === layoutFingerprint("current")) return "current";
  return fingerprint === layoutFingerprint("legacy-identity-map")
    ? "legacy-identity-map"
    : undefined;
}

// Only the known retired field is accepted, never arbitrary extra columns.
// It is discarded; neither its contents nor archived maps translate identities.
export const BridgeRawDocumentLakeRowSchema = RawDocumentLakeRowSchema.extend({
  identity_map_json: z.string().optional(),
}).transform(({ identity_map_json: _retired, ...row }) => row);
