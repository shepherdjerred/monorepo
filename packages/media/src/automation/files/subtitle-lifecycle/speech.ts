import { z } from "zod";
import { createHash } from "node:crypto";
import type { SubtitleAsset } from "#generated/prisma/client.ts";
import { realpath } from "node:fs/promises";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { libraryLocation } from "#automation/files/removal-plan.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { measureSubtitleSpeech } from "#filesystem/subtitle-speech.ts";
import {
  regularDialogueCovered,
  needsRegularDialogueProof,
  needsSubtitleTimingV1,
} from "#domain/subtitle-speech.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import { requirePublicationExecution } from "#automation/publication-proof/invocation.ts";

/** Read-only video measurement and candidate-only evidence; never publishes or changes the provider's forced label. */
export async function prepareSubtitleSpeechV1(
  context: FileContext,
  input: { subtitleId: string; operationId: string },
) {
  const execution = requirePublicationExecution(
    context.publicationExecution?.(),
  );
  const subtitle = await context.db.subtitleAsset.findUniqueOrThrow({
    where: { id: input.subtitleId },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  const evidence = z
    .record(z.string(), z.json())
    .parse(subtitle.matchingEvidence);
  const regularRequired = needsRegularDialogueProof(
    evidence,
    subtitle.videoChecksum,
    subtitle.checksum,
  );
  const regularTarget = evidence["regularDialogueRequiredV1"] === true;
  if (
    !regularRequired &&
    !needsSubtitleTimingV1(evidence, subtitle.videoChecksum, subtitle.checksum)
  )
    return;
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const command = z
    .object({
      assetId: z.string(),
      targetAuthority: z.string(),
      recoveryEpoch: z.int(),
    })
    .parse(operation.payload);
  const content = requireSpeechCandidate(
    subtitle,
    command,
    evidence,
    regularTarget,
  );
  const asset = subtitle.asset;
  const mediaIds = asset.coverage.map((c) => c.mediaId);
  const authorize = async () => {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (
      !(await context.enabled.acquisition()) ||
      !asset.owned ||
      asset.state !== "published" ||
      asset.checksum === null ||
      asset.version !== subtitle.videoVersion ||
      asset.checksum !== subtitle.videoChecksum ||
      asset.ownershipEpoch !== subtitle.ownershipEpoch ||
      mediaIds.length === 0 ||
      !(await recordsAuthorized(context.db, {
        epoch: subtitle.ownershipEpoch,
        mediaIds,
        assetIds: [asset.id],
      }))
    )
      throw new FileGuardError("subtitle_speech_asset_protected");
    await context.db.$transaction(async (tx) => {
      if (!(await lockRuntimeAuthority(tx, subtitle.ownershipEpoch)))
        throw new FileGuardError("runtime_protected");
      await assertNoSubtitleReplacement(tx, [asset.id]);
      const current = await tx.libraryAsset.findUniqueOrThrow({
        where: { id: asset.id },
      });
      if (
        current.version !== asset.version ||
        current.checksum !== asset.checksum ||
        current.path !== asset.path ||
        current.state !== "published" ||
        !current.owned
      )
        throw new FileGuardError("subtitle_speech_asset_changed");
    });
  };
  await authorize();
  const location = libraryLocation(context, asset.path);
  const roots = context.roots[location.libraryKind];
  await context.verifyStorageAuthority(roots);
  await fileOperations(context, roots, () =>
    Promise.reject(new Error("Caption analysis cannot publish")),
  ).readManifest(input.operationId);
  const path = workerFilePath(context, asset.path);
  if ((await realpath(path)) !== path)
    throw new FileGuardError("subtitle_speech_video_unsafe");
  const checkpoint = async () => {
    execution.assertActive();
    execution.signal.throwIfAborted();
    await context.checkpoint("subtitle-speech-measurement");
  };
  // One full integrity read; subsequent checks retain that descriptor/ancestor identity, not a second hash.
  const proof = new ContentProof();
  await proof.capture(path, checkpoint);
  const captured = await proof.reviewCaptured(path);
  if (captured.file?.sha256 !== asset.checksum)
    throw new FileGuardError("subtitle_speech_video_checksum_changed");
  const probe = await (context.inspect ?? inspectMedia)(path);
  const runtimeMs = Math.round(Number(probe.format.duration) * 1000);
  const provenance = z
    .object({
      filename: z.string(),
      description: z.string(),
      format: z.enum(["srt", "ass", "ssa", "vtt"]),
    })
    .parse(subtitle.provenance);
  const validated = validateSubtitle({
    bytes: content,
    filename: provenance.filename,
    provenanceText: provenance.description,
    requireSimplified: ["zh-CN", "zh-Hans"].includes(subtitle.language),
  });
  if (
    createHash("sha256").update(validated.text).digest("hex") !==
    subtitle.checksum
  )
    throw new FileGuardError("subtitle_content_changed");
  const measured = await measureSubtitleSpeech({
    videoPath: path,
    controlRoot: roots.control,
    text: validated.text,
    format: validated.format,
    runtimeMs,
    videoChecksum: asset.checksum,
    subtitleChecksum: subtitle.checksum,
    signal: execution.signal,
    checkpoint,
    synchronize: true,
    requireSimplified: ["zh-CN", "zh-Hans"].includes(subtitle.language),
  });
  await proof.reviewCaptured(path);
  await authorize();
  const accepted =
    !regularTarget ||
    regularDialogueCovered(measured.proof, asset.checksum, measured.checksum);
  const changed = await context.db.subtitleAsset.updateMany({
    where: {
      id: subtitle.id,
      version: subtitle.version,
      state: "validated",
      checksum: subtitle.checksum,
      videoChecksum: asset.checksum,
      videoVersion: asset.version,
    },
    data: {
      matchingEvidence: {
        ...evidence,
        regularDialogueV1: measured.proof,
        ...(accepted
          ? {}
          : { reason: "subtitle_regular_dialogue_not_covered" }),
        ...(accepted
          ? {
              timingAlignedV1: {
                schemaVersion: 1,
                videoChecksum: asset.checksum,
                subtitleChecksum: measured.checksum,
                engine: "ffsubsync-0.5.1",
                maxOffsetSeconds: 60,
                goldenSectionRequested: true,
                fixFrameRate: false,
              },
            }
          : {}),
      },
      qualityStatus: accepted ? "accepted" : "rejected",
      version: { increment: 1 },
      ...timingChange(
        accepted,
        {
          checksum: subtitle.checksum,
          content,
          provenance: subtitle.provenance,
        },
        measured,
      ),
    },
  });
  if (changed.count !== 1)
    throw new FileGuardError("subtitle_speech_candidate_changed");
  if (!accepted)
    throw new FileGuardError("subtitle_regular_dialogue_not_covered");
}

function requireSpeechCandidate(
  subtitle: Pick<
    SubtitleAsset,
    | "assetId"
    | "ownershipEpoch"
    | "state"
    | "qualityStatus"
    | "forced"
    | "content"
  >,
  command: { assetId: string; targetAuthority: string; recoveryEpoch: number },
  evidence: Record<string, unknown>,
  regularTarget: boolean,
) {
  if (
    command.assetId !== subtitle.assetId ||
    command.targetAuthority !== evidence["targetAuthority"] ||
    command.recoveryEpoch !== subtitle.ownershipEpoch ||
    subtitle.state !== "validated" ||
    subtitle.qualityStatus !== "accepted" ||
    (regularTarget && subtitle.forced !== null) ||
    subtitle.content === null
  )
    throw new FileGuardError("subtitle_speech_candidate_changed");
  return subtitle.content;
}

function timingChange(
  accepted: boolean,
  original: {
    checksum: string | null;
    content: Uint8Array;
    provenance: unknown;
  },
  synchronized: { checksum: string; text: string },
) {
  if (!accepted || synchronized.checksum === original.checksum) return {};
  return {
    content: new TextEncoder().encode(synchronized.text),
    checksum: synchronized.checksum,
    provenance: {
      ...z.record(z.string(), z.json()).parse(original.provenance),
      originalTimingV1: {
        checksum: original.checksum,
        contentBase64: Buffer.from(original.content).toString("base64"),
      },
      timingSyncV1: {
        engine: "ffsubsync-0.5.1",
        maxOffsetSeconds: 60,
        goldenSectionRequested: true,
        fixFrameRate: false,
      },
    },
  };
}
