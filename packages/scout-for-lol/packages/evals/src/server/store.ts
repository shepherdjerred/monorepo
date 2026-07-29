import type { Database } from "bun:sqlite";
import { z } from "zod";

import { openEvalDatabase } from "#server/database.ts";
import {
  CASE_SUMMARY_SQL,
  CaseCountRowSchema,
  DATASET_SUMMARY_SQL,
  NextOrdinalRowSchema,
  NextVersionRowSchema,
} from "#server/store-queries.ts";
import {
  CaseArtifactSchema,
  CaseDetailSchema,
  CaseIdSchema,
  CaseSummarySchema,
  CreateDatasetInputSchema,
  DatasetIdSchema,
  DatasetSummarySchema,
  FreshnessRatingSchema,
  GenerationIdSchema,
  GenerationSchema,
  HumanRatingSchema,
  RecordGenerationInputSchema,
  StyleBatchSchema,
  UpsertFreshnessRatingInputSchema,
  UpsertHumanRatingInputSchema,
} from "#shared/schema.ts";

const AddMaterializedCaseInputSchema = z.strictObject({
  datasetId: DatasetIdSchema,
  artifact: CaseArtifactSchema,
});

const DatasetSummaryRowSchema = DatasetSummarySchema;

const CaseSummaryRowSchema = CaseSummarySchema.omit({ isRated: true }).extend({
  isRated: z.union([z.literal(0), z.literal(1)]),
});

const ArtifactRowSchema = z.strictObject({ artifactJson: z.string().min(1) });

const NavigationRowSchema = z.strictObject({
  previousCaseId: CaseIdSchema.nullable(),
  nextCaseId: CaseIdSchema.nullable(),
});

const HumanRatingRowSchema = HumanRatingSchema;
const FreshnessRatingRowSchema = FreshnessRatingSchema;
const StyleReviewRowSchema = StyleBatchSchema.shape.reviews.element;

export type CreateDatasetInput = z.input<typeof CreateDatasetInputSchema>;
export type AddMaterializedCaseInput = z.input<
  typeof AddMaterializedCaseInputSchema
>;
export type RecordGenerationInput = z.input<typeof RecordGenerationInputSchema>;
export type UpsertHumanRatingInput = z.input<
  typeof UpsertHumanRatingInputSchema
>;
export type UpsertFreshnessRatingInput = z.input<
  typeof UpsertFreshnessRatingInputSchema
>;
export type Generation = z.infer<typeof GenerationSchema>;
export type CaseDetail = z.infer<typeof CaseDetailSchema>;
export type StyleBatch = z.infer<typeof StyleBatchSchema>;
export type FreshnessRating = z.infer<typeof FreshnessRatingSchema>;

function parseCaseSummary(row: unknown): z.infer<typeof CaseSummarySchema> {
  const parsed = CaseSummaryRowSchema.parse(row);
  return CaseSummarySchema.parse({
    ...parsed,
    isRated: parsed.isRated === 1,
  });
}

function readDatasetSummary(
  database: Database,
  datasetId: string,
): z.infer<typeof DatasetSummarySchema> {
  return DatasetSummaryRowSchema.parse(
    database
      .query(
        `${DATASET_SUMMARY_SQL}
         WHERE d.id = ?
         GROUP BY d.id`,
      )
      .get(datasetId),
  );
}

function readCaseSummary(
  database: Database,
  caseId: string,
): z.infer<typeof CaseSummarySchema> {
  return parseCaseSummary(
    database.query(`${CASE_SUMMARY_SQL} WHERE c.id = ?`).get(caseId),
  );
}

export class EvalStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public listDatasets(): z.infer<typeof DatasetSummarySchema>[] {
    return z.array(DatasetSummaryRowSchema).parse(
      this.#database
        .query(
          `${DATASET_SUMMARY_SQL}
             GROUP BY d.id
             ORDER BY d.created_at DESC, d.dataset_key, d.version DESC`,
        )
        .all(),
    );
  }

  public createDataset(
    input: CreateDatasetInput,
  ): z.infer<typeof DatasetSummarySchema> {
    const parsed = CreateDatasetInputSchema.parse(input);
    return this.#database.transaction(() => {
      const versionRow = NextVersionRowSchema.parse(
        this.#database
          .query(
            `SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
             FROM datasets
             WHERE dataset_key = ?`,
          )
          .get(parsed.key),
      );
      const id = DatasetIdSchema.parse(crypto.randomUUID());
      const createdAt = new Date().toISOString();
      this.#database
        .query(
          `INSERT INTO datasets (
             id, dataset_key, version, name, description, status, created_at
           ) VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
        )
        .run(
          id,
          parsed.key,
          versionRow.nextVersion,
          parsed.name,
          parsed.description,
          createdAt,
        );
      return readDatasetSummary(this.#database, id);
    })();
  }

  public finalizeDataset(
    datasetId: string,
  ): z.infer<typeof DatasetSummarySchema> {
    const id = DatasetIdSchema.parse(datasetId);
    const current = readDatasetSummary(this.#database, id);
    if (current.status === "finalized") {
      throw new Error(`Dataset ${id} is already finalized`);
    }

    const { caseCount } = CaseCountRowSchema.parse(
      this.#database
        .query(
          `SELECT COUNT(*) AS caseCount
           FROM dataset_cases
           WHERE dataset_id = ?`,
        )
        .get(id),
    );
    if (caseCount === 0) {
      throw new Error(`Cannot finalize empty dataset ${id}`);
    }

    this.#database
      .query(
        `UPDATE datasets
         SET status = 'finalized', finalized_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
    return readDatasetSummary(this.#database, id);
  }

  public addMaterializedCase(
    input: AddMaterializedCaseInput,
  ): z.infer<typeof CaseSummarySchema> {
    const parsed = AddMaterializedCaseInputSchema.parse(input);
    return this.#database.transaction(() => {
      const ordinalRow = NextOrdinalRowSchema.parse(
        this.#database
          .query(
            `SELECT COALESCE(MAX(ordinal), -1) + 1 AS nextOrdinal
             FROM dataset_cases
             WHERE dataset_id = ?`,
          )
          .get(parsed.datasetId),
      );
      const id = CaseIdSchema.parse(crypto.randomUUID());
      this.#database
        .query(
          `INSERT INTO dataset_cases (
             id, dataset_id, ordinal, match_id, target_player_name,
             target_player_puuid, champion_name, performance_slice, style_key,
             artifact_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          parsed.datasetId,
          ordinalRow.nextOrdinal,
          parsed.artifact.matchId,
          parsed.artifact.targetPlayerName,
          parsed.artifact.targetPlayerPuuid,
          parsed.artifact.championName,
          parsed.artifact.performanceSlice,
          parsed.artifact.styleKey,
          JSON.stringify(parsed.artifact),
          new Date().toISOString(),
        );
      return readCaseSummary(this.#database, id);
    })();
  }

  public listCases(datasetId: string): z.infer<typeof CaseSummarySchema>[] {
    const id = DatasetIdSchema.parse(datasetId);
    return this.#database
      .query(
        `${CASE_SUMMARY_SQL}
         WHERE c.dataset_id = ?
         ORDER BY c.ordinal`,
      )
      .all(id)
      .map((row) => parseCaseSummary(row));
  }

  public getCaseDetail(datasetId: string, caseId: string): CaseDetail {
    const parentId = DatasetIdSchema.parse(datasetId);
    const id = CaseIdSchema.parse(caseId);
    const summary = readCaseSummary(this.#database, id);
    if (summary.datasetId !== parentId) {
      throw new Error(`Case ${id} does not belong to dataset ${parentId}`);
    }
    const artifactRow = ArtifactRowSchema.parse(
      this.#database
        .query(
          "SELECT artifact_json AS artifactJson FROM dataset_cases WHERE id = ?",
        )
        .get(id),
    );
    const artifact = CaseArtifactSchema.parse(
      JSON.parse(artifactRow.artifactJson),
    );
    const navigation = NavigationRowSchema.parse(
      this.#database
        .query(
          `SELECT
             (
               SELECT previous.id
               FROM dataset_cases previous
               WHERE previous.dataset_id = current.dataset_id
                 AND previous.ordinal < current.ordinal
               ORDER BY previous.ordinal DESC
               LIMIT 1
             ) AS previousCaseId,
             (
               SELECT next.id
               FROM dataset_cases next
               WHERE next.dataset_id = current.dataset_id
                 AND next.ordinal > current.ordinal
               ORDER BY next.ordinal
               LIMIT 1
             ) AS nextCaseId
           FROM dataset_cases current
           WHERE current.id = ?`,
        )
        .get(id),
    );

    const generation =
      summary.generationId === null
        ? null
        : GenerationSchema.parse(
            this.#database
              .query(
                `SELECT
                   id,
                   output_text AS outputText,
                   model,
                   prompt_revision AS promptRevision,
                   duration_ms AS durationMs,
                   input_tokens AS inputTokens,
                   output_tokens AS outputTokens
                 FROM generations
                 WHERE id = ?`,
              )
              .get(summary.generationId),
          );
    const rawRating =
      summary.generationId === null
        ? null
        : this.#database
            .query(
              `SELECT
                 anchoredness,
                 entertainment,
                 style_recognizability AS styleRecognizability,
                 note
               FROM human_ratings
               WHERE generation_id = ?`,
            )
            .get(summary.generationId);
    const rating =
      rawRating === null ? null : HumanRatingRowSchema.parse(rawRating);

    return CaseDetailSchema.parse({
      summary,
      artifact,
      generation,
      rating,
      ...navigation,
    });
  }

  public recordGeneration(input: RecordGenerationInput): Generation {
    const parsed = RecordGenerationInputSchema.parse(input);
    const generation = GenerationSchema.parse({
      id: GenerationIdSchema.parse(crypto.randomUUID()),
      outputText: parsed.outputText,
      model: parsed.model,
      promptRevision: parsed.promptRevision,
      durationMs: parsed.durationMs,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    });
    this.#database.transaction(() => {
      this.#database
        .query(
          `INSERT INTO generations (
             id, case_id, output_text, model, prompt_revision, duration_ms,
             input_tokens, output_tokens, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          generation.id,
          parsed.caseId,
          generation.outputText,
          generation.model,
          generation.promptRevision,
          generation.durationMs,
          generation.inputTokens,
          generation.outputTokens,
          new Date().toISOString(),
        );
      this.#database
        .query(
          `DELETE FROM freshness_ratings
           WHERE (dataset_id, style_key) = (
             SELECT dataset_id, style_key FROM dataset_cases WHERE id = ?
           )`,
        )
        .run(parsed.caseId);
    })();
    return generation;
  }

  public upsertHumanRating(
    input: UpsertHumanRatingInput,
  ): z.infer<typeof HumanRatingSchema> {
    const parsed = UpsertHumanRatingInputSchema.parse(input);
    const timestamp = new Date().toISOString();
    this.#database
      .query(
        `INSERT INTO human_ratings (
           generation_id, anchoredness, entertainment, style_recognizability,
           note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(generation_id) DO UPDATE SET
           anchoredness = excluded.anchoredness,
           entertainment = excluded.entertainment,
           style_recognizability = excluded.style_recognizability,
           note = excluded.note,
           updated_at = excluded.updated_at`,
      )
      .run(
        parsed.generationId,
        parsed.rating.anchoredness,
        parsed.rating.entertainment,
        parsed.rating.styleRecognizability,
        parsed.rating.note,
        timestamp,
        timestamp,
      );
    return HumanRatingRowSchema.parse(
      this.#database
        .query(
          `SELECT
             anchoredness,
             entertainment,
             style_recognizability AS styleRecognizability,
             note
           FROM human_ratings
           WHERE generation_id = ?`,
        )
        .get(parsed.generationId),
    );
  }

  public listStyleBatch(datasetId: string, styleKey: string): StyleBatch {
    const id = DatasetIdSchema.parse(datasetId);
    const style = z.string().trim().min(1).parse(styleKey);
    readDatasetSummary(this.#database, id);

    const reviews = z.array(StyleReviewRowSchema).parse(
      this.#database
        .query(
          `SELECT
               c.id AS caseId,
               c.target_player_name AS playerName,
               c.champion_name AS championName,
               c.performance_slice AS performanceSlice,
               latest_generation.output_text AS outputText
             FROM dataset_cases c
             JOIN generations latest_generation ON latest_generation.id = (
               SELECT generation.id
               FROM generations generation
               WHERE generation.case_id = c.id
               ORDER BY generation.sequence DESC
               LIMIT 1
             )
             WHERE c.dataset_id = ? AND c.style_key = ?
             ORDER BY c.ordinal`,
        )
        .all(id, style),
    );
    if (reviews.length === 0) {
      throw new Error(
        `Dataset ${id} has no generated reviews for style ${style}`,
      );
    }
    const rawRating = this.#database
      .query(
        `SELECT score, note
         FROM freshness_ratings
         WHERE dataset_id = ? AND style_key = ?`,
      )
      .get(id, style);
    const rating =
      rawRating === null ? null : FreshnessRatingRowSchema.parse(rawRating);
    return StyleBatchSchema.parse({
      datasetId: id,
      styleKey: style,
      reviews,
      rating,
    });
  }

  public upsertFreshnessRating(
    input: UpsertFreshnessRatingInput,
  ): FreshnessRating {
    const parsed = UpsertFreshnessRatingInputSchema.parse(input);
    this.listStyleBatch(parsed.datasetId, parsed.styleKey);
    const timestamp = new Date().toISOString();
    this.#database
      .query(
        `INSERT INTO freshness_ratings (
           dataset_id, style_key, score, note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(dataset_id, style_key) DO UPDATE SET
           score = excluded.score,
           note = excluded.note,
           updated_at = excluded.updated_at`,
      )
      .run(
        parsed.datasetId,
        parsed.styleKey,
        parsed.rating.score,
        parsed.rating.note,
        timestamp,
        timestamp,
      );
    return FreshnessRatingRowSchema.parse(
      this.#database
        .query(
          `SELECT score, note
           FROM freshness_ratings
           WHERE dataset_id = ? AND style_key = ?`,
        )
        .get(parsed.datasetId, parsed.styleKey),
    );
  }

  public close(): void {
    this.#database.close();
  }
}

export function createEvalStore(databasePath: string): EvalStore {
  return new EvalStore(openEvalDatabase(databasePath));
}
