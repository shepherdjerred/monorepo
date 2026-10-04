import { z } from "zod";
import type { DuckDbColumnType } from "./lake-columns.ts";

export const RawDocumentLakeRowSchema = z.strictObject({
  document_id: z.string(),
  match_id: z.string(),
  kind: z.enum(["match", "prematch", "timeline"]),
  captured_at: z.string(),
  source_key: z.string().nullable(),
  source_digest: z.string(),
  document_json: z.string(),
  identity_map_json: z.string(),
  month: z.string(),
});
export type RawDocumentLakeRow = z.infer<typeof RawDocumentLakeRowSchema>;
export const RAW_DOCUMENT_LAKE_COLUMNS = {
  document_id: "VARCHAR",
  match_id: "VARCHAR",
  kind: "VARCHAR",
  captured_at: "TIMESTAMP",
  source_key: "VARCHAR",
  source_digest: "VARCHAR",
  document_json: "VARCHAR",
  identity_map_json: "VARCHAR",
  month: "VARCHAR",
} as const satisfies Record<keyof RawDocumentLakeRow, DuckDbColumnType>;
