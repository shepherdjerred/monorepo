import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { RAW_DOCUMENT_LAKE_COLUMNS } from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import { readBuildFingerprint } from "#src/report-lake/build-manifest.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { listStagingFiles } from "#src/report-lake/staging.ts";
import { captureAnalysisGeneration } from "#src/explore/analysis/lake-generation.ts";
import { buildUnionSource, listParam } from "#src/reports/duckdb/lake.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

const RowSchema = z.looseObject({
  match_id: RiotMatchIdSchema,
  kind: z.enum(["match", "prematch", "timeline"]),
  source_key: z.string().nullable(),
  source_digest: z.string(),
  captured_at: z.string(),
  document_json: z.string(),
  identity_map_json: z.string(),
});

export async function readRawDocuments(input: {
  matchIds: RiotMatchId[];
  kinds: string[];
  signal: AbortSignal;
  lakeDir?: string;
}) {
  const lakeDir = input.lakeDir ?? resolveLakeDir();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const captured = await captureAnalysisGeneration(lakeDir);
    const paths: string[] = [];
    try {
      return await readCapturedDocuments(input, lakeDir, captured, paths);
    } catch (error) {
      if (input.signal.aborted) throw error;
      const existing = await Promise.all(
        paths.map(async (file) => await Bun.file(file).exists()),
      );
      const missing = existing.includes(false);
      const current = await captureAnalysisGeneration(lakeDir);
      const changed = captured.id !== current.id;
      if (!missing && !changed) throw error;
      lastError = error;
    }
  }
  throw new Error(
    "The raw-document lake snapshot disappeared during three attempts.",
    { cause: lastError },
  );
}

async function readCapturedDocuments(
  input: { matchIds: RiotMatchId[]; kinds: string[]; signal: AbortSignal },
  lakeDir: string,
  captured: Awaited<ReturnType<typeof captureAnalysisGeneration>>,
  paths: string[],
) {
  const { buildDir, staging } = captured;
  if (
    buildDir === undefined ||
    (await readBuildFingerprint(buildDir)) !== lakeSchemaFingerprint()
  ) {
    throw new Error(
      "Raw-document analysis requires the report lake to be rebuilt at the current schema.",
    );
  }
  const parquet: string[] = [];
  for await (const file of new Bun.Glob("raw_documents/**/*.parquet").scan({
    cwd: buildDir,
    absolute: true,
  }))
    parquet.push(file);
  const stagingFiles = await listStagingFiles(
    lakeDir,
    "raw_documents",
    staging,
  );
  paths.push(...parquet, ...stagingFiles);
  const source = buildUnionSource({
    parquetFiles: parquet.toSorted(),
    stagingFiles,
    columns: RAW_DOCUMENT_LAKE_COLUMNS,
    dedupe: "raw-documents",
    predicate: {
      sql: "match_id IN (SELECT unnest(?)) AND kind IN (SELECT unnest(?))",
      params: [listParam(input.matchIds), listParam(input.kinds)],
    },
  });
  const generation = captured.id;
  if (source === undefined) return { generation, documents: [] };
  const documents = await withDuckDBConnection(
    async (session) => {
      const params = source.params.map((param) =>
        param.kind === "scalar" ? param.value : session.list(param.values),
      );
      const sizes = await session.run(
        `SELECT coalesce(sum(octet_length(encode(document_json))), 0)::DOUBLE AS bytes FROM (${source.sql})`,
        params,
      );
      const size = z.object({ bytes: z.number() }).parse(sizes[0]);
      if (size.bytes > 64 * 1024 * 1024)
        throw new Error("Raw documents exceed 64 MiB. Select fewer matches.");
      const rows = await session.run(
        `SELECT match_id, kind, source_key, source_digest, CAST(captured_at AS VARCHAR) AS captured_at, document_json, identity_map_json FROM (${source.sql}) ORDER BY match_id, kind`,
        params,
      );
      return rows.map((row) => {
        const parsed = RowSchema.parse(row);
        const document = z.json().parse(JSON.parse(parsed.document_json));
        // Spectator credentials remain in canonical storage, never in model data.
        if (
          document !== null &&
          typeof document === "object" &&
          !Array.isArray(document) &&
          parsed.kind === "prematch"
        )
          delete document["observers"];
        return {
          matchId: parsed.match_id,
          kind: parsed.kind,
          sourceKey: parsed.source_key,
          digest: parsed.source_digest,
          capturedAt: parsed.captured_at,
          document,
          identityMap: z
            .record(z.string(), z.string())
            .parse(JSON.parse(parsed.identity_map_json)),
        };
      });
    },
    { abortSignal: input.signal },
  );
  return { generation, documents };
}
