import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { type SeriesPackNativeActivityV1 } from "#shared/native-recovery/series-pack/runtime.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { loadSeriesPackNativePhaseV1 } from "#infrastructure/native-compensation/series-pack/phase.ts";
import { readSeriesPackNativeCompletedV1 } from "#infrastructure/native-compensation/series-pack/completed.ts";
import {
  readSeriesPackNativePublicationV1,
  assertSeriesPackNativePublicationCommandV1,
} from "#infrastructure/native-compensation/series-pack/publication/record.ts";
import { readSeriesPackNativeCoreRecordV1 } from "#infrastructure/native-compensation/series-pack/records.ts";

export async function seriesPackNativeCompensationStateV1(
  context: { db: Database },
  raw: SeriesPackNativeActivityV1,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
) {
  execution.assertActive();
  const input = NativeCompensationActivityInputSchema.parse(raw);
  const result = await context.db.$transaction(
    async (tx) => {
      const locator =
        await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
          select: { publicationCoordinatorOperationId: true },
        });
      budget.consume(1);
      if (locator.publicationCoordinatorOperationId === input.operationId) {
        const record = await readSeriesPackNativeCoreRecordV1(
          tx,
          input.continuationId,
          budget,
        );
        const operation = await tx.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        });
        budget.consume(1);
        assertSeriesPackNativePublicationCommandV1(record, operation, input);
        const published = await readSeriesPackNativePublicationV1(
          tx,
          input,
          budget,
        );
        return {
          state: "compensated" as const,
          publicationVerified: published !== null,
        };
      }
      const completed = await readSeriesPackNativeCompletedV1(
        tx,
        input,
        budget,
      );
      if (completed !== null) {
        const operationId = completed.row.publicationCoordinatorOperationId;
        const published =
          operationId === null
            ? null
            : await readSeriesPackNativePublicationV1(
                tx,
                { ...input, operationId },
                budget,
              );
        return {
          state: "compensated" as const,
          publicationVerified: published !== null,
        };
      }
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: execution.expiresAtMs,
        guards: [execution],
      });
      const phase = await loadSeriesPackNativePhaseV1(tx, input, budget, {
        freshness,
        observe: true,
      });
      if (phase.kind === "completed")
        return { state: "compensated" as const, publicationVerified: false };
      await phase.assertCurrent();
      const state = z
        .enum(["pending", "compensating", "protected"])
        .parse(phase.record.row.state);
      phase.close();
      return { state, publicationVerified: false };
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  execution.assertActive();
  return result;
}
