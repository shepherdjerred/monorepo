import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  SubtitleReplacementInput,
  SubtitleReplacementFileActivities,
} from "#shared/subtitle-replacement.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { MovieReplacementSnapshotV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import { readMovieReplacementReceiptV2 } from "#infrastructure/movie-editions/subtitle-replacement/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { movieReplacementInvocation } from "./authority.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { reserveMovieRollbackCaptionSqlV1 } from "#infrastructure/movie-editions/rollback/read-budget.ts";

export type MovieReplacementPhase = keyof SubtitleReplacementFileActivities;
const phaseKinds: Record<MovieReplacementPhase, readonly string[]> = {
  prepareSubtitleReplacement: ["prepare_subtitle_replacement"],
  applySubtitleReplacement: ["apply_subtitle_replacement"],
  reconcileSubtitleReplacement: [
    "reconcile_subtitle_replacement",
    "apply_subtitle_replacement",
    "prepare_subtitle_replacement",
  ],
  cleanupSubtitleReplacement: ["cleanup_subtitle_replacement"],
};

/** Explicit caller capabilities are captured before lazy loading and remain one invocation. */
export function createMovieSubtitleReplacementFileFacet(initial: FileContext) {
  return async (
    phase: MovieReplacementPhase,
    raw: SubtitleReplacementInput,
    invocation: {
      execution: PublicationExecution;
      budget: PublicationAuthorityReadBudget;
    },
  ) => {
    const context = movieReplacementInvocation({
      ...initial,
      publicationExecution: () => invocation.execution,
      movieManagement: invocation,
    });
    const input = z
      .object({
        replacementId: z.uuid(),
        operationId: z.uuid(),
        movieScope: MovieEditionScopeSchema,
      })
      .parse(raw);
    try {
      const row = await context.db.subtitleReplacement.findUniqueOrThrow({
        where: { id: input.replacementId },
      });
      const snapshot = MovieReplacementSnapshotV2Schema.parse(row.snapshot);
      const command = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      invocation.budget.consume(2);
      const payload = z
        .object({
          replacementId: z.literal(row.id),
          movieScope: MovieEditionScopeSchema,
        })
        .parse(command.payload);
      if (
        identityHash(input.movieScope) !== identityHash(snapshot.scope) ||
        identityHash(payload.movieScope) !== identityHash(snapshot.scope) ||
        command.targetId !== row.id ||
        !phaseKinds[phase].includes(command.kind)
      )
        throw new FileGuardError("subtitle_replacement_operation_changed");
      if (phase !== "cleanupSubtitleReplacement") {
        const previous = await readMovieReplacementReceiptV2(
          context.db,
          row.id,
          invocation.budget,
        );
        if (previous !== null) {
          invocation.execution.assertActive();
          invocation.execution.signal.throwIfAborted();
          if (phase === "prepareSubtitleReplacement")
            return { state: "ready" as const };
          return {
            state:
              previous.row.receipt?.outcome === "installed"
                ? ("applied" as const)
                : ("rolled_back" as const),
          };
        }
      }
      if (
        phase === "applySubtitleReplacement" ||
        phase === "reconcileSubtitleReplacement"
      )
        reserveMovieRollbackCaptionSqlV1(
          invocation.budget,
          snapshot,
          "settlement",
        );
      return await createSubtitleReplacementActivities(context)[phase](input);
    } catch (error) {
      if (error instanceof NativeArchiveScopeProtection)
        return { state: "protected" as const, reason: error.code };
      throw error;
    }
  };
}
