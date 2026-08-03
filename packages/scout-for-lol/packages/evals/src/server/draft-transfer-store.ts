import type { Database } from "bun:sqlite";
import { z } from "zod";

import {
  canonicalJson,
  createDraftTransfer,
  validateDraftTransfer,
} from "#server/dataset-transfer.ts";
import {
  INSERT_GENERATION_SQL,
  parseGenerationRow,
  SELECT_GENERATION_SQL,
} from "#server/generation.ts";
import { DATASET_SUMMARY_SQL } from "#server/store-queries.ts";
import {
  CaseArtifactSchema,
  CaseIdSchema,
  DatasetIdSchema,
  DatasetStatusSchema,
  DatasetSummarySchema,
  DraftTransferMetadataSchema,
  type DatasetDraftTransfer,
  type DatasetSummary,
} from "#shared/schema.ts";

const DraftDatasetRowSchema = DraftTransferMetadataSchema.extend({
  status: DatasetStatusSchema,
});

const DraftCaseRowSchema = z.strictObject({
  id: CaseIdSchema,
  ordinal: z.number().int().nonnegative(),
  artifactJson: z.string().min(1),
});

const ExistingCaseRowSchema = z.strictObject({
  datasetId: DatasetIdSchema,
  ordinal: z.number().int().nonnegative(),
  artifactJson: z.string().min(1),
});

const ExistingIdRowSchema = z.strictObject({ id: z.string().min(1) });

const GenerationCaseRowSchema = z.strictObject({ caseId: CaseIdSchema });

function readDraftMetadata(
  database: Database,
  datasetId: string,
): z.infer<typeof DraftTransferMetadataSchema> {
  const metadata = DraftDatasetRowSchema.parse(
    database
      .query(
        `SELECT
           id,
           dataset_key AS key,
           version,
           name,
           description,
           status,
           created_at AS createdAt
         FROM datasets
         WHERE id = ?`,
      )
      .get(datasetId),
  );
  if (metadata.status !== "draft") {
    throw new Error(`Dataset ${datasetId} must be a draft to transfer drafts`);
  }
  return DraftTransferMetadataSchema.parse(metadata);
}

function readDraftSnapshot(
  database: Database,
  id: string,
): DatasetDraftTransfer {
  if (!database.inTransaction) {
    throw new Error("Draft export requires an active SQLite transaction");
  }
  const dataset = readDraftMetadata(database, id);
  const caseRows = z.array(DraftCaseRowSchema).parse(
    database
      .query(
        `SELECT id, ordinal, artifact_json AS artifactJson
         FROM dataset_cases
         WHERE dataset_id = ?
         ORDER BY ordinal`,
      )
      .all(id),
  );
  if (caseRows.length === 0) {
    throw new Error(`Draft dataset ${id} has no cases to transfer`);
  }
  return createDraftTransfer({
    schemaVersion: 1,
    dataset,
    cases: caseRows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      artifact: CaseArtifactSchema.parse(JSON.parse(row.artifactJson)),
      generations: database
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
        .all(row.id)
        .map((generationRow) => parseGenerationRow(generationRow)),
    })),
  });
}

export function exportDraftFromDatabase(
  database: Database,
  datasetId: string,
): DatasetDraftTransfer {
  const id = DatasetIdSchema.parse(datasetId);
  return database.transaction(() => readDraftSnapshot(database, id)).deferred();
}

function ensureTargetDataset(
  database: Database,
  dataset: DatasetDraftTransfer["dataset"],
): void {
  const existing = DraftDatasetRowSchema.nullable().parse(
    database
      .query(
        `SELECT
           id,
           dataset_key AS key,
           version,
           name,
           description,
           status,
           created_at AS createdAt
         FROM datasets
         WHERE id = ?`,
      )
      .get(dataset.id),
  );
  if (existing !== null) {
    if (existing.status === "finalized") {
      throw new Error(
        `Dataset ${dataset.id} is finalized and cannot accept draft pushes`,
      );
    }
    const incoming = { ...dataset, status: existing.status };
    if (canonicalJson(existing) !== canonicalJson(incoming)) {
      throw new Error(
        `Dataset ${dataset.id} already exists with different metadata; ` +
          "draft pushes never overwrite existing records",
      );
    }
    return;
  }

  const versionCollision = ExistingIdRowSchema.nullable().parse(
    database
      .query(
        `SELECT id FROM datasets
         WHERE dataset_key = ? AND version = ?`,
      )
      .get(dataset.key, dataset.version),
  );
  if (versionCollision !== null) {
    throw new Error(
      `Dataset ${dataset.key} version ${String(dataset.version)} already ` +
        `exists as ${versionCollision.id}`,
    );
  }

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
}

function ensureCase(
  database: Database,
  datasetId: string,
  evalCase: DatasetDraftTransfer["cases"][number],
  receivedAt: string,
): void {
  const existing = ExistingCaseRowSchema.nullable().parse(
    database
      .query(
        `SELECT dataset_id AS datasetId, ordinal, artifact_json AS artifactJson
         FROM dataset_cases
         WHERE id = ?`,
      )
      .get(evalCase.id),
  );
  if (existing !== null) {
    if (existing.datasetId !== datasetId) {
      throw new Error(
        `Case ${evalCase.id} already belongs to dataset ${existing.datasetId}`,
      );
    }
    if (existing.ordinal !== evalCase.ordinal) {
      throw new Error(
        `Case ${evalCase.id} already exists at ordinal ` +
          `${String(existing.ordinal)}, not ${String(evalCase.ordinal)}`,
      );
    }
    const existingArtifact = CaseArtifactSchema.parse(
      JSON.parse(existing.artifactJson),
    );
    if (canonicalJson(existingArtifact) !== canonicalJson(evalCase.artifact)) {
      throw new Error(
        `Case ${evalCase.id} already exists with a different artifact; ` +
          "draft pushes never overwrite existing records",
      );
    }
    return;
  }

  const ordinalCollision = ExistingIdRowSchema.nullable().parse(
    database
      .query(
        `SELECT id FROM dataset_cases
         WHERE dataset_id = ? AND ordinal = ?`,
      )
      .get(datasetId, evalCase.ordinal),
  );
  if (ordinalCollision !== null) {
    throw new Error(
      `Dataset ${datasetId} already has case ${ordinalCollision.id} at ` +
        `ordinal ${String(evalCase.ordinal)}`,
    );
  }

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
      datasetId,
      evalCase.ordinal,
      artifact.matchId,
      artifact.targetPlayerName,
      artifact.targetPlayerPuuid,
      artifact.championName,
      artifact.performanceSlice,
      artifact.styleKey,
      JSON.stringify(artifact),
      receivedAt,
    );
}

function ensureGeneration(
  database: Database,
  caseId: string,
  generation: DatasetDraftTransfer["cases"][number]["generations"][number],
  receivedAt: string,
): boolean {
  const owner = GenerationCaseRowSchema.nullable().parse(
    database
      .query("SELECT case_id AS caseId FROM generations WHERE id = ?")
      .get(generation.id),
  );
  if (owner !== null) {
    if (owner.caseId !== caseId) {
      throw new Error(
        `Generation ${generation.id} already belongs to case ${owner.caseId}`,
      );
    }
    const existing = parseGenerationRow(
      database.query(SELECT_GENERATION_SQL).get(generation.id),
    );
    if (canonicalJson(existing) !== canonicalJson(generation)) {
      throw new Error(
        `Generation ${generation.id} already exists with different content; ` +
          "draft pushes never overwrite existing records",
      );
    }
    return false;
  }

  database
    .query(INSERT_GENERATION_SQL)
    .run(
      generation.id,
      caseId,
      generation.outputText,
      generation.model,
      generation.promptRevision,
      JSON.stringify(generation.renderedPrompts),
      generation.durationMs,
      generation.inputTokens,
      generation.outputTokens,
      receivedAt,
    );
  return true;
}

export function pushDraftIntoDatabase(
  database: Database,
  value: unknown,
): DatasetSummary {
  const transfer = validateDraftTransfer(value);
  const receivedAt = new Date().toISOString();
  return database.transaction(() => {
    ensureTargetDataset(database, transfer.dataset);

    // A pushed generation extends a style batch, so any freshness rating for
    // that style no longer describes the current generation set. Mirror
    // EvalStore.recordGeneration and drop it; existing human ratings attach to
    // untouched generations and survive every push.
    const staleStyles = new Set<string>();
    for (const evalCase of transfer.cases) {
      ensureCase(database, transfer.dataset.id, evalCase, receivedAt);
      for (const generation of evalCase.generations) {
        if (ensureGeneration(database, evalCase.id, generation, receivedAt)) {
          staleStyles.add(evalCase.artifact.styleKey);
        }
      }
    }
    for (const styleKey of staleStyles) {
      database
        .query(
          "DELETE FROM freshness_ratings WHERE dataset_id = ? AND style_key = ?",
        )
        .run(transfer.dataset.id, styleKey);
    }

    return DatasetSummarySchema.parse(
      database
        .query(
          `${DATASET_SUMMARY_SQL}
           WHERE d.id = ?
           GROUP BY d.id`,
        )
        .get(transfer.dataset.id),
    );
  })();
}
