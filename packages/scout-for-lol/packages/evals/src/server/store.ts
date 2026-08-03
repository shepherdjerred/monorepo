import type { Database } from "bun:sqlite";
import { z } from "zod";

import { openEvalDatabase } from "#server/database.ts";
import {
  exportDatasetFromDatabase,
  importDatasetIntoDatabase,
} from "#server/dataset-transfer-store.ts";
import {
  exportDraftFromDatabase,
  pushDraftIntoDatabase,
} from "#server/draft-transfer-store.ts";
import {
  generationSetRevision,
  requireCurrentGenerationSet,
  requireFreshnessAvailable,
  SELECT_FRESHNESS_RATING_SQL,
  type FreshnessRating,
  type UpsertFreshnessRatingInput,
  UPSERT_FRESHNESS_RATING_SQL,
} from "#server/freshness.ts";
import {
  INSERT_GENERATION_SQL,
  parseGenerationRow,
  SELECT_GENERATION_SQL,
} from "#server/generation.ts";
import {
  CASE_SUMMARY_SQL,
  CaseCountRowSchema,
  DATASET_SUMMARY_SQL,
  NextOrdinalRowSchema,
  NextVersionRowSchema,
  parseCaseSummary,
  readCaseSummary,
  readDatasetSummary,
} from "#server/store-queries.ts";
import {
  CaseArtifactSchema,
  CaseDetailSchema,
  CaseIdSchema,
  type CaseSummary,
  CreateDatasetInputSchema,
  DatasetIdSchema,
  type DatasetDraftTransfer,
  type DatasetExport,
  type DatasetSummary,
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
export type Generation = z.infer<typeof GenerationSchema>;
export type CaseDetail = z.infer<typeof CaseDetailSchema>;
export type StyleBatch = z.infer<typeof StyleBatchSchema>;

export class EvalStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public runInTransaction<Result>(operation: () => Result): Result {
    return this.#database.transaction(operation)();
  }

  public listDatasets(): DatasetSummary[] {
    return z.array(DatasetSummarySchema).parse(
      this.#database
        .query(
          `${DATASET_SUMMARY_SQL}
             GROUP BY d.id
             ORDER BY d.created_at DESC, d.dataset_key, d.version DESC`,
        )
        .all(),
    );
  }

  public createDataset(input: CreateDatasetInput): DatasetSummary {
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
    expectedCaseCount: number,
  ): DatasetSummary {
    const id = DatasetIdSchema.parse(datasetId);
    // The count check and the status flip must be atomic: a concurrent
    // materialization could append a case between them, otherwise, letting
    // unseen cases into the permanently locked artifact.
    return this.#database.transaction(() => {
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
      // Cases are append-only, so a count mismatch means the membership the
      // reviewer saw is not the membership about to be locked.
      if (caseCount !== expectedCaseCount) {
        throw new Error(
          `Dataset ${id} membership changed since it was reviewed ` +
            `(expected ${String(expectedCaseCount)} cases, found ${String(caseCount)}); ` +
            `reload the dataset before finalizing`,
        );
      }

      this.#database
        .query(
          `UPDATE datasets
           SET status = 'finalized', finalized_at = ?
           WHERE id = ?`,
        )
        .run(new Date().toISOString(), id);
      return readDatasetSummary(this.#database, id);
    })();
  }

  public exportDataset(datasetId: string): DatasetExport {
    return exportDatasetFromDatabase(this.#database, datasetId);
  }

  public importDataset(value: unknown): DatasetSummary {
    return importDatasetIntoDatabase(this.#database, value);
  }

  public exportDraft(datasetId: string): DatasetDraftTransfer {
    return exportDraftFromDatabase(this.#database, datasetId);
  }

  public pushDraft(value: unknown): DatasetSummary {
    return pushDraftIntoDatabase(this.#database, value);
  }

  public addMaterializedCase(input: AddMaterializedCaseInput): CaseSummary {
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

  public listCases(datasetId: string): CaseSummary[] {
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
        : parseGenerationRow(
            this.#database
              .query(SELECT_GENERATION_SQL)
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
      renderedPrompts: parsed.renderedPrompts,
      durationMs: parsed.durationMs,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    });
    this.#database.transaction(() => {
      this.#database
        .query(INSERT_GENERATION_SQL)
        .run(
          generation.id,
          parsed.caseId,
          generation.outputText,
          generation.model,
          generation.promptRevision,
          JSON.stringify(generation.renderedPrompts),
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
               latest_generation.id AS generationId,
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
    requireFreshnessAvailable(this.#database, id);
    const rawRating = this.#database
      .query(SELECT_FRESHNESS_RATING_SQL)
      .get(id, style);
    const rating =
      rawRating === null ? null : FreshnessRatingRowSchema.parse(rawRating);
    return StyleBatchSchema.parse({
      datasetId: id,
      styleKey: style,
      generationSetRevision: generationSetRevision(reviews),
      reviews,
      rating,
    });
  }

  public upsertFreshnessRating(
    input: UpsertFreshnessRatingInput,
  ): FreshnessRating {
    const parsed = UpsertFreshnessRatingInputSchema.parse(input);
    return this.#database.transaction(() => {
      const currentBatch = this.listStyleBatch(
        parsed.datasetId,
        parsed.styleKey,
      );
      requireCurrentGenerationSet(
        parsed.generationSetRevision,
        currentBatch.generationSetRevision,
      );
      const timestamp = new Date().toISOString();
      this.#database
        .query(UPSERT_FRESHNESS_RATING_SQL)
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
          .query(SELECT_FRESHNESS_RATING_SQL)
          .get(parsed.datasetId, parsed.styleKey),
      );
    })();
  }

  public close(): void {
    this.#database.close();
  }
}

export const createEvalStore = (databasePath: string): EvalStore =>
  new EvalStore(openEvalDatabase(databasePath));
