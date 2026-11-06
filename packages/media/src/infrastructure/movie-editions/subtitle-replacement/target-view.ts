import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { MovieSubtitleTargetV2Schema } from "#shared/movie-editions/subtitle-target-v2.ts";
import {
  assertReplacementOwner,
  lockSubtitleReplacementScope,
} from "#infrastructure/subtitle-replacement/locks.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";

export async function movieSubtitleTargetV2(
  tx: Prisma.TransactionClient,
  input: {
    actor: MediaActor;
    scope: MovieEditionScope;
    access: MovieChoiceAccess;
    budget: PublicationAuthorityReadBudget;
  },
) {
  await assertReplacementOwner(tx, input.actor.id);
  const current = await tx.assetCoverage.findMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      current: true,
    },
    select: { assetId: true },
    take: 2,
  });
  if (current.length !== 1 || current[0] === undefined)
    throw new MediaError(
      "subtitle_asset_unavailable",
      "This edition needs one current video before replacing captions",
      409,
    );
  await lockSubtitleReplacementScope(tx, {
    assetId: current[0].assetId,
    mediaIds: [input.scope.mediaId],
    movieScope: input.scope,
  });
  const runtime = await runtimeAuthority(tx);
  const work = await currentMovieSubtitleWorkV4(
    tx,
    {
      scope: input.scope,
      assetId: current[0].assetId,
      epoch: runtime.epoch,
      access: input.access,
    },
    input.budget,
  );
  const coverage = work.asset.coverage[0];
  if (
    coverage?.mediaId !== input.scope.mediaId ||
    work.protectedReasons.length > 0
  )
    throw new MediaError(
      "subtitle_target_protected",
      "This edition's caption target needs review before replacement",
      409,
    );
  const captions = await tx.subtitleAsset.findMany({
    where: {
      assetId: work.asset.id,
      ownershipEpoch: runtime.epoch,
      videoVersion: work.asset.version,
      videoChecksum: work.asset.checksum,
      state: { in: ["installed", "validated"] },
    },
    orderBy: { id: "asc" },
    take: 201,
  });
  if (captions.length > 200)
    throw new MediaError(
      "subtitle_inventory_limit",
      "Caption selection exceeds its inventory bound",
      409,
    );
  work.freshness.assertActive();
  return MovieSubtitleTargetV2Schema.parse({
    schemaVersion: 2,
    scope: input.scope,
    editionLabel: movieEditionDisplayLabel(input.scope.edition),
    assetId: work.asset.id,
    version: work.asset.version,
    checksum: work.asset.checksum,
    filename: path.basename(work.asset.path),
    titles: [coverage.media.title],
    installedLanguages: [
      ...new Set(
        captions
          .filter((caption) => caption.state === "installed")
          .map((caption) => caption.language),
      ),
    ],
    subtitles: captions.map((caption) => ({
      id: caption.id,
      version: caption.version,
      state: caption.state,
      qualityStatus: caption.qualityStatus,
      language: caption.language,
      forced: caption.forced,
      hearingImpaired: caption.hearingImpaired,
      providerId: caption.providerId,
      filename: caption.path === null ? null : path.basename(caption.path),
      storageKind: caption.storageKind,
    })),
  });
}
