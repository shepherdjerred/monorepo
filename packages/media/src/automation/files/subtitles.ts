import nodePath from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, realpath, lstat } from "node:fs/promises";
import { z } from "zod";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import {
  FileGuardError,
  GenerationsSchema,
  type FileContext,
} from "./types.ts";
import { assertRuntime, lockMedia } from "./guards.ts";
import { libraryLocation } from "./removal-plan.ts";
import { fileOperations } from "./file-operations.ts";
import { queueLifecycleNotifications } from "#automation/notifications/events.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { assertSubtitleTarget } from "#automation/subtitles/install-authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";

export async function installSubtitle(
  context: FileContext,
  subtitleId: string,
  operationId: string,
): Promise<void> {
  z.string()
    .regex(/^[\w-]{1,100}$/u)
    .parse(subtitleId);
  const subtitle = await context.db.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitleId },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  if (subtitle.storageKind === "embedded" || subtitle.state === "installed") {
    await context.db.$transaction(async (tx) => {
      const ids = subtitle.asset.coverage.map((item) => item.mediaId);
      await lockMedia(tx, ids);
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
  const provenance = z
    .object({
      filename: z.string(),
      description: z.string(),
      format: z.enum(["srt", "ass", "ssa", "vtt"]),
    })
    .loose()
    .parse(subtitle.provenance);
  if (subtitle.content === null)
    throw new FileGuardError("subtitle_content_missing");
  const validated = validateSubtitle({
    bytes: subtitle.content,
    filename: provenance.filename,
    requireSimplified: ["zh-CN", "zh-Hans"].includes(subtitle.language),
    provenanceText: provenance.description,
  });
  if (validated.format !== provenance.format)
    throw new FileGuardError("subtitle_format_mismatch");
  const bytes = Buffer.from(validated.text);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const location = libraryLocation(context, subtitle.asset.path);
  const roots = context.roots[location.libraryKind];
  const files = fileOperations(
    context,
    { ...roots, downloads: roots.control },
    () => Promise.reject(new Error("Subtitle staging cannot publish")),
  );
  // Reading a journal checks the configured Plex exclusion before any control-root write.
  await files.readManifest(operationId);
  const relativeSource = `subtitles/${subtitleId}.${validated.format}`;
  const source = nodePath.join(roots.control, relativeSource);
  await mkdir(nodePath.dirname(source), { recursive: true });
  if ((await realpath(nodePath.dirname(source))) !== nodePath.dirname(source))
    throw new FileGuardError("subtitle_staging_unsafe");
  try {
    await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!z.object({ code: z.literal("EEXIST") }).safeParse(error).success)
      throw error;
    const existing = await lstat(source);
    if (!existing.isFile() || (await realpath(source)) !== source)
      throw new FileGuardError("subtitle_staging_unsafe");
    if (!bytes.equals(await readFile(source)))
      throw new FileGuardError("subtitle_staging_conflict");
  }
  const language = z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u)
    .parse(subtitle.language);
  const suffix = `${subtitle.forced === true ? ".forced" : ""}${subtitle.hearingImpaired === true ? ".sdh" : ""}`;
  const libraryPath = `${location.libraryPath.slice(0, -nodePath.extname(location.libraryPath).length)}.${language}${suffix}.${validated.format}`;
  const descriptor = {
    operationId,
    downloadPath: relativeSource,
    libraryPath,
    sha256: checksum,
  };
  await files.importFile({ ...descriptor, stopAfterStaging: true });
  await context.db.$transaction(
    async (tx) => {
      const mediaIds = subtitle.asset.coverage.map(
        (coverage) => coverage.mediaId,
      );
      await lockMedia(tx, mediaIds);
      await lockEffectiveRequests(tx, mediaIds);
      await assertRuntime(tx, evidence.recoveryEpoch);
      await lockSubtitlePolicies(tx);
      const authorize = async () => {
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
          where: { mediaId: { in: mediaIds } },
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
      await fileOperations(
        context,
        { ...roots, downloads: roots.control },
        authorize,
      ).importFile(descriptor);
      await tx.subtitleAsset.update({
        where: { id: subtitleId },
        data: {
          state: "installed",
          path: nodePath.join(roots.library, libraryPath),
          provenance: { ...provenance, checksum },
          checksum,
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
    },
    { timeout: 60_000 },
  );
}
