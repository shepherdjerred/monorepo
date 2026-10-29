import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import { storedFilePath } from "./paths/locations.ts";
import { z } from "zod";
import {
  FileGuardError,
  GenerationsSchema,
  type FileContext,
} from "./types.ts";
import { assertRuntime, lockMedia } from "./guards.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { fileOperations } from "./file-operations.ts";
import { queueLifecycleNotifications } from "#automation/notifications/events.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import {
  assertSubtitleTarget,
  installedEmbeddedEvidence,
} from "#automation/subtitles/install-authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";
import { stageSubtitleContent } from "./subtitle-lifecycle/content.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

export async function installSubtitle(
  initialContext: FileContext,
  subtitleId: string,
  operationId: string,
): Promise<void> {
  let context = initialContext;
  const execution = context.publicationExecution?.();
  execution?.assertActive();
  z.string()
    .regex(/^[\w-]{1,100}$/u)
    .parse(subtitleId);
  const subtitle = await context.db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  if (
    z
      .object({ replacementFor: z.unknown() })
      .safeParse(subtitle.matchingEvidence).success
  )
    throw new FileGuardError("subtitle_replacement_review_required");
  if (subtitle.storageKind === "embedded" || subtitle.state === "installed") {
    await context.db.$transaction(async (tx) => {
      const ids = subtitle.asset.coverage.map((item) => item.mediaId);
      await lockMedia(tx, ids);
      await assertPublicationUnfenced(tx, ids, [subtitle.assetId]);
      await assertNoSubtitleReplacement(tx, [subtitle.assetId]);
      await lockEffectiveRequests(tx, ids);
      await assertRuntime(tx, subtitle.ownershipEpoch);
      await lockSubtitlePolicies(tx);
      await assertSubtitleTarget(tx, {
        operationId,
        subtitleId,
        epoch: subtitle.ownershipEpoch,
      });
    });
    return;
  }
  // Safe owned caption installation precedes first Plex publication; no serving prerequisite.
  const invocation = publicationInvocation(
    context,
    requirePublicationExecution(execution),
  );
  context = invocation;
  const evidence = z
    .object({
      assetVersion: z.number().int(),
      assetChecksum: z.string(),
      exactMediaMatch: z.literal(true),
      videoVersionMatch: z.literal(true),
      recoveryEpoch: z.number().int(),
      generations: GenerationsSchema,
    })
    .parse(subtitle.matchingEvidence);
  if (
    !subtitleAccepted({
      subtitle,
      asset: subtitle.asset,
      epoch: evidence.recoveryEpoch,
      allowStaged: true,
    })
  )
    throw new FileGuardError("subtitle_quality_unaccepted");
  const { provenance, checksum, location, roots, libraryPath, descriptor } =
    await stageSubtitleContent(invocation, subtitle, operationId);
  await context.db.$transaction(
    async (tx) => {
      const mediaIds = subtitle.asset.coverage.map(
        (coverage) => coverage.mediaId,
      );
      await lockMedia(tx, mediaIds);
      await assertNoSubtitleReplacement(tx, [subtitle.assetId]);
      await lockEffectiveRequests(tx, mediaIds);
      await assertRuntime(tx, evidence.recoveryEpoch);
      await lockSubtitlePolicies(tx);
      const authorize = async () => {
        await assertPublicationUnfenced(tx, mediaIds, [subtitle.assetId]);
        await context.checkpoint("subtitle-authorization");
        if (!(await context.enabled.acquisition()))
          throw new FileGuardError("acquisition_disabled");
        await assertRuntime(tx, evidence.recoveryEpoch);
        await assertSubtitleTarget(tx, {
          operationId,
          subtitleId,
          epoch: evidence.recoveryEpoch,
        });
        const asset = await tx.libraryAsset.findUniqueOrThrow({
          where: { id: subtitle.assetId },
          include: { coverage: { where: { current: true } } },
        });
        await assertDefaultPhysicalAsset(tx, asset.id);
        const currentSubtitle = await tx.subtitleAsset.findUniqueOrThrow({
          where: { id: subtitleId },
        });
        if (
          currentSubtitle.version !== subtitle.version ||
          !subtitleAccepted({
            subtitle: currentSubtitle,
            asset,
            epoch: evidence.recoveryEpoch,
            allowStaged: true,
          })
        )
          throw new FileGuardError("subtitle_quality_changed");
        if (
          !asset.owned ||
          asset.ownershipEpoch !== evidence.recoveryEpoch ||
          asset.version !== evidence.assetVersion ||
          asset.checksum !== evidence.assetChecksum ||
          asset.state !== "published" ||
          asset.coverage.length !== mediaIds.length
        )
          throw new FileGuardError("subtitle_obsolete");
        const intents = await tx.mediaIntent.findMany({
          where: { mediaId: { in: mediaIds }, edition: "default" },
        });
        if (
          intents.length !== mediaIds.length ||
          intents.some(
            (intent) =>
              !intent.desiredPresence ||
              intent.automationEpoch !== evidence.recoveryEpoch ||
              intent.generation !== evidence.generations[intent.mediaId],
          )
        )
          throw new FileGuardError("subtitle_obsolete");
      };
      await authorize();
      const freshness = await publicationAuthorityDeadline(tx, invocation, {
        libraryKind: location.libraryKind,
        recoveryEpoch: evidence.recoveryEpoch,
      });
      await bindPlexTransactionDeadline(tx, freshness);
      await fileOperations(
        context,
        { ...roots, downloads: roots.control },
        authorize,
        freshness.assertActive,
      ).importFile({ ...descriptor, allowDuplicateTarget: false });
      const installation = {
        operationId,
        subtitleId,
        epoch: evidence.recoveryEpoch,
      };
      const currentWork = await assertSubtitleTarget(tx, installation);
      const matchingEvidence = await installedEmbeddedEvidence(
        tx,
        installation,
        currentWork,
      );
      await tx.subtitleAsset.update({
        where: { id: subtitleId },
        data: {
          state: "installed",
          path: storedFilePath(
            context,
            location.libraryKind,
            "library",
            libraryPath,
          ),
          provenance: { ...provenance, checksum },
          checksum,
          matchingEvidence,
          version: { increment: 1 },
        },
      });
      const work = await assertSubtitleTarget(tx, {
        operationId,
        subtitleId,
        epoch: evidence.recoveryEpoch,
      });
      if (
        work.targets.length > 0 &&
        subtitleTargetsReady(work, evidence.recoveryEpoch)
      )
        await queueLifecycleNotifications(tx, {
          key: `subtitle-installed:${subtitleId}:${String(evidence.assetVersion)}`,
          kind: "subtitles_ready",
          epoch: evidence.recoveryEpoch,
          items: mediaIds.map((mediaId) => ({
            mediaId,
            generation: z.number().int().parse(evidence.generations[mediaId]),
            assetId: subtitle.assetId,
            assetVersion: evidence.assetVersion,
            assetChecksum: evidence.assetChecksum,
            subtitleId,
            language: subtitle.language,
          })),
        });
      freshness.assertActive();
    },
    { timeout: 60_000 },
  );
}
