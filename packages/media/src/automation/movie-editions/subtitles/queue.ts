import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { queueOperation } from "#automation/store.ts";
import { targetKey } from "#automation/subtitles/authority.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { currentMovieSubtitleWorkV4 } from "./authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Transactional producer; held from dispatch until its complete v4 Workflow is registered. */
export async function queueMovieSubtitleTargetsV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    assetId: string;
    epoch: number;
    access: MovieChoiceAccess;
  },
  budget = new PublicationAuthorityReadBudget(),
) {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    runtime.mode !== "active" ||
    !runtime.ownershipConfirmed ||
    runtime.recoveryEpoch !== input.epoch
  )
    return 0;
  const work = await currentMovieSubtitleWorkV4(tx, input, budget);
  if (work.protectedReasons.length > 0) return 0;
  let queued = 0;
  for (const target of work.targets) {
    if (
      work.asset.subtitles.some((subtitle) =>
        subtitleAccepted({
          subtitle,
          asset: work.asset,
          epoch: input.epoch,
          target,
        }),
      )
    )
      continue;
    const key = `movie-subtitle-v4:${input.assetId}:${targetKey(target)}:${work.authority}`;
    if (
      (await tx.operation.findUnique({ where: { idempotencyKey: key } })) !==
      null
    )
      continue;
    await queueOperation(tx, {
      key,
      kind: "acquire_movie_subtitles_v4",
      targetId: input.assetId,
      payload: {
        schemaVersion: 4,
        scope: input.scope,
        assetId: input.assetId,
        ...target,
        targetAuthority: work.authority,
      },
    });
    queued++;
  }
  return queued;
}
