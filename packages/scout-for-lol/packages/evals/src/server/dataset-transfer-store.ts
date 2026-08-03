import type { Database } from "bun:sqlite";
import { z } from "zod";

import {
  createDatasetExport,
  validateDatasetExport,
} from "#server/dataset-transfer.ts";
import { styleGenerationSetRevision } from "#server/freshness.ts";
import {
  INSERT_GENERATION_SQL,
  parseGenerationRow,
} from "#server/generation.ts";
import { DATASET_SUMMARY_SQL } from "#server/store-queries.ts";
import {
  CaseArtifactSchema,
  CaseIdSchema,
  DatasetExportMetadataSchema,
  DatasetIdSchema,
  DatasetStatusSchema,
  DatasetSummarySchema,
  FreshnessRatingSchema,
  HumanRatingSchema,
  type DatasetExport,
} from "#shared/schema.ts";

const DatasetMetadataRowSchema = DatasetExportMetadataSchema.extend({
  status: DatasetStatusSchema,
  finalizedAt: z.iso.datetime().nullable(),
});

const DatasetCaseRowSchema = z.strictObject({
  id: CaseIdSchema,
  ordinal: z.number().int().nonnegative(),
  artifactJson: z.string().min(1),
});

const FreshnessRatingRowSchema = FreshnessRatingSchema.extend({
  styleKey: z.string().min(1),
});

const ExistingDatasetRowSchema = z.strictObject({
  id: DatasetIdSchema,
  key: z.string().min(1),
  version: z.number().int().positive(),
});

const ExistingIdRowSchema = z.strictObject({ id: z.string().min(1) });

function readDatasetMetadata(
  database: Database,
  datasetId: string,
): z.infer<typeof DatasetExportMetadataSchema> {
  const metadata = DatasetMetadataRowSchema.parse(
    database
      .query(
        `SELECT
           id,
           dataset_key AS key,
           version,
           name,
           description,
           status,
           created_at AS createdAt,
           finalized_at AS finalizedAt
         FROM datasets
         WHERE id = ?`,
      )
      .get(datasetId),
  );
  if (metadata.status !== "finalized" || metadata.finalizedAt === null) {
    throw new Error(`Dataset ${datasetId} must be finalized before export`);
  }
  return DatasetExportMetadataSchema.parse(metadata);
}

function readGenerationRating(
  database: Database,
  generationId: string,
): z.infer<typeof HumanRatingSchema> | null {
  const row = database
    .query(
      `SELECT
         anchoredness,
         entertainment,
         style_recognizability AS styleRecognizability,
         note
       FROM human_ratings
       WHERE generation_id = ?`,
    )
    .get(generationId);
  return row === null ? null : HumanRatingSchema.parse(row);
}

function readDatasetExportSnapshot(
  database: Database,
  id: string,
): DatasetExport {
  if (!database.inTransaction) {
    throw new Error("Dataset export requires an active SQLite transaction");
  }
  const dataset = readDatasetMetadata(database, id);
  const caseRows = z.array(DatasetCaseRowSchema).parse(
    database
      .query(
        `SELECT id, ordinal, artifact_json AS artifactJson
         FROM dataset_cases
         WHERE dataset_id = ?
         ORDER BY ordinal`,
      )
      .all(id),
  );
  const cases = caseRows.map((row) => {
    const generationRows = database
      .query(
        `SELECT
           id,
           output_text AS outputText,
           model,
           prompt_revision AS promptRevision,
           rendered_prompts_json AS renderedPromptsJson,
           duration_ms AS durationMs,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens
         FROM generations
         WHERE case_id = ?
         ORDER BY sequence`,
      )
      .all(row.id);
    return {
      id: row.id,
      ordinal: row.ordinal,
      artifact: CaseArtifactSchema.parse(JSON.parse(row.artifactJson)),
      generations: generationRows.map((generationRow) => {
        const generation = parseGenerationRow(generationRow);
        return {
          generation,
          rating: readGenerationRating(database, generation.id),
        };
      }),
    };
  });
  const freshnessRatings = z.array(FreshnessRatingRowSchema).parse(
    database
      .query(
        `SELECT style_key AS styleKey, score, note
         FROM freshness_ratings
         WHERE dataset_id = ?
         ORDER BY style_key`,
      )
      .all(id),
  );

  return createDatasetExport({
    schemaVersion: 1,
    dataset,
    cases,
    freshnessRatings: freshnessRatings.map(({ styleKey, ...rating }) => ({
      styleKey,
      generationSetRevision: styleGenerationSetRevision(cases, styleKey),
      rating,
    })),
  });
}

export function exportDatasetFromDatabase(
  database: Database,
  datasetId: string,
): DatasetExport {
  const id = DatasetIdSchema.parse(datasetId);
  return database
    .transaction(() => readDatasetExportSnapshot(database, id))
    .deferred();
}

function requireNoDatasetCollision(
  database: Database,
  datasetExport: DatasetExport,
): void {
  const idCollision = ExistingDatasetRowSchema.nullable().parse(
    database
      .query(
        `SELECT id, dataset_key AS key, version
         FROM datasets
         WHERE id = ?`,
      )
      .get(datasetExport.dataset.id),
  );
  if (idCollision !== null) {
    throw new Error(`Dataset id ${datasetExport.dataset.id} already exists`);
  }

  const versionCollision = ExistingDatasetRowSchema.nullable().parse(
    database
      .query(
        `SELECT id, dataset_key AS key, version
         FROM datasets
         WHERE dataset_key = ? AND version = ?`,
      )
      .get(datasetExport.dataset.key, datasetExport.dataset.version),
  );
  if (versionCollision !== null) {
    throw new Error(
      `Dataset ${datasetExport.dataset.key} version ${String(datasetExport.dataset.version)} already exists as ${versionCollision.id}`,
    );
  }
}

function requireIdAvailable(
  database: Database,
  table: "dataset_cases" | "generations",
  id: string,
  label: "Case" | "Generation",
): void {
  const collision = ExistingIdRowSchema.nullable().parse(
    database.query(`SELECT id FROM ${table} WHERE id = ?`).get(id),
  );
  if (collision !== null) {
    throw new Error(`${label} id ${id} already exists`);
  }
}

function requireNoRecordCollisions(
  database: Database,
  datasetExport: DatasetExport,
): void {
  for (const evalCase of datasetExport.cases) {
    requireIdAvailable(database, "dataset_cases", evalCase.id, "Case");
    for (const record of evalCase.generations) {
      requireIdAvailable(
        database,
        "generations",
        record.generation.id,
        "Generation",
      );
    }
  }
}

function insertImportedDataset(
  database: Database,
  datasetExport: DatasetExport,
): void {
  const { dataset } = datasetExport;
  database
    .query(
      `INSERT INTO datasets (
         id, dataset_key, version, name, description, status, created_at
       ) VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    )
    .run(
      dataset.id,
      dataset.key,
      dataset.version,
      dataset.name,
      dataset.description,
      dataset.createdAt,
    );

  for (const evalCase of datasetExport.cases) {
    const { artifact } = evalCase;
    database
      .query(
        `INSERT INTO dataset_cases (
           id, dataset_id, ordinal, match_id, target_player_name,
           target_player_puuid, champion_name, performance_slice, style_key,
           artifact_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evalCase.id,
        dataset.id,
        evalCase.ordinal,
        artifact.matchId,
        artifact.targetPlayerName,
        artifact.targetPlayerPuuid,
        artifact.championName,
        artifact.performanceSlice,
        artifact.styleKey,
        JSON.stringify(artifact),
        dataset.createdAt,
      );

    for (const record of evalCase.generations) {
      const { generation, rating } = record;
      database
        .query(INSERT_GENERATION_SQL)
        .run(
          generation.id,
          evalCase.id,
          generation.outputText,
          generation.model,
          generation.promptRevision,
          JSON.stringify(generation.renderedPrompts),
          generation.durationMs,
          generation.inputTokens,
          generation.outputTokens,
          dataset.createdAt,
        );
      if (rating !== null) {
        database
          .query(
            `INSERT INTO human_ratings (
               generation_id, anchoredness, entertainment,
               style_recognizability, note, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            generation.id,
            rating.anchoredness,
            rating.entertainment,
            rating.styleRecognizability,
            rating.note,
            dataset.createdAt,
            dataset.createdAt,
          );
      }
    }
  }

  for (const freshness of datasetExport.freshnessRatings) {
    database
      .query(
        `INSERT INTO freshness_ratings (
           dataset_id, style_key, score, note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dataset.id,
        freshness.styleKey,
        freshness.rating.score,
        freshness.rating.note,
        dataset.createdAt,
        dataset.createdAt,
      );
  }

  database
    .query(
      `UPDATE datasets
       SET status = 'finalized', finalized_at = ?
       WHERE id = ?`,
    )
    .run(dataset.finalizedAt, dataset.id);
}

function requireFreshnessGenerationSets(datasetExport: DatasetExport): void {
  for (const freshness of datasetExport.freshnessRatings) {
    const expected = styleGenerationSetRevision(
      datasetExport.cases,
      freshness.styleKey,
    );
    if (freshness.generationSetRevision !== expected) {
      throw new Error(
        `Freshness rating for style ${freshness.styleKey} was evaluated against a ` +
          `different generation set than the transferred cases (declared ` +
          `${freshness.generationSetRevision}, transferred cases produce ${expected})`,
      );
    }
  }
}

export function importDatasetIntoDatabase(
  database: Database,
  value: unknown,
): z.infer<typeof DatasetSummarySchema> {
  const datasetExport = validateDatasetExport(value);
  requireFreshnessGenerationSets(datasetExport);
  return database.transaction(() => {
    requireNoDatasetCollision(database, datasetExport);
    requireNoRecordCollisions(database, datasetExport);
    insertImportedDataset(database, datasetExport);
    return DatasetSummarySchema.parse(
      database
        .query(
          `${DATASET_SUMMARY_SQL}
           WHERE d.id = ?
           GROUP BY d.id`,
        )
        .get(datasetExport.dataset.id),
    );
  })();
}
