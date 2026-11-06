import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { inspectEntry } from "#automation/files/inspection.ts";
import {
  SeriesPackStagingPreparedV1Schema,
  type SeriesPackStagingInputV1,
  type SeriesPackStagingScopeV1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import {
  SeriesPackStagingObservationV1Schema,
  type seriesPackStagingMembersV1,
  assertSeriesPackStagingPlanV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/scope.ts";
import { createSeriesPackStagingReceiptV1 } from "#infrastructure/acquisition-identity/series-pack/staging/receipts.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { authorizeSeriesPackStagingV1 } from "./current.ts";

/** Exact existing inspect/prepare transaction; no grant or capture is reused across invocations. */
export async function prepareSeriesPackStagingBatchV1(
  context: PublicationContext,
  selected: {
    attempt: Parameters<typeof inspectEntry>[0]["attempt"];
    observation: unknown;
    scope: SeriesPackStagingScopeV1;
    input: SeriesPackStagingInputV1;
    members: ReturnType<typeof seriesPackStagingMembersV1>;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { attempt, scope, input } = selected;
  const members = selected.members;
  const observed = SeriesPackStagingObservationV1Schema.parse(
    selected.observation,
  );
  const media = await context.db.mediaItem.findMany({
    where: { id: { in: attempt.mediaIds } },
    include: { parent: { include: { parent: true } } },
  });
  const entries = [];
  try {
    for (const member of members) {
      const file = observed.files.find(
        (item) => item.index === member.torrentFileIndex,
      );
      if (file === undefined)
        throw new FileGuardError("torrent_file_identity_changed");
      entries.push(
        await inspectEntry({
          context,
          attempt,
          file,
          media,
          savePath: observed.torrent.save_path,
          movieAccess: undefined,
          seriesPackStagingV1: true,
        }),
      );
    }
  } catch (error) {
    if (
      error instanceof FileGuardError &&
      error.reason === "series_pack_staging_ack_required"
    )
      return { kind: "ack" as const };
    throw error;
  }
  const prepared = SeriesPackStagingPreparedV1Schema.parse({
    schemaVersion: 1,
    scope,
    scopeHash: identityHash(scope),
    batchIndex: input.batchIndex,
    entries,
  });
  const receipt = await context.db.$transaction(
    async (tx) => {
      const current = await authorizeSeriesPackStagingV1(tx, context, scope);
      if (current.attempt.filePlan !== null)
        throw new FileGuardError("series_pack_staging_already_sealed");
      assertSeriesPackStagingPlanV1(
        current.attempt,
        current.torrent.observation,
        prepared.entries,
      );
      const stored = await createSeriesPackStagingReceiptV1(
        tx,
        prepared,
        budget,
      );
      current.deadline.assertActive();
      return stored;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return { kind: "prepared" as const, receipt };
}
