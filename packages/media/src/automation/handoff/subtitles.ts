import path from "node:path";
import { lstat } from "node:fs/promises";
import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import { safePath } from "#filesystem/operations-io.ts";
import type { MediaProbe } from "#filesystem/media-tools.ts";
import type { HandoffScope, HandoffFile } from "#shared/handoff.ts";
import { HandoffSubtitleEvidenceSchema } from "#shared/subtitle-handoff.ts";
import type { FileContext } from "#automation/files/types.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";

export async function captureHandoffSubtitles(input: {
  context: FileContext;
  scope: HandoffScope;
  content: ContentProof;
  file: HandoffFile;
  probe: MediaProbe;
}) {
  const subtitles = input.scope.subtitles.filter(
    (item) => item.assetId === input.file.assetId,
  );
  const codecs = new Map<string, string | null>();
  for (const subtitle of subtitles) {
    if (subtitle.canonicalPath === null) {
      codecs.set(subtitle.id, embeddedCodec(input.probe, subtitle));
    } else {
      const roots = input.context.roots[input.file.libraryKind];
      const relative = path.relative(roots.library, subtitle.canonicalPath);
      if (
        (await safePath(roots.library, relative, false)) !==
        subtitle.canonicalPath
      )
        throw new Error("Subtitle canonical root changed");
      const info = await lstat(subtitle.canonicalPath);
      if (info.size > 8 * 1024 * 1024)
        throw new Error("Subtitle content exceeds inspection bound");
      await input.content.capture(subtitle.canonicalPath, () =>
        input.context.checkpoint("handoff-subtitle-hashing"),
      );
      codecs.set(subtitle.id, null);
    }
  }
  return codecs;
}

function embeddedCodec(
  probe: MediaProbe,
  subtitle: HandoffScope["subtitles"][number],
) {
  const stream = probe.streams.find(
    (item) =>
      item.index === subtitle.streamIndex && item.codec_type === "subtitle",
  );
  const language = stream?.tags?.language;
  const normalized =
    language === "eng"
      ? "en"
      : ["zho", "chi"].includes(language ?? "")
        ? "zh"
        : language;
  const matchesFlag = (expected: boolean | null, actual: number | undefined) =>
    expected === null || (actual !== undefined && Boolean(actual) === expected);
  if (
    stream?.codec_name === undefined ||
    normalized !== subtitle.language ||
    !matchesFlag(subtitle.forced, stream.disposition?.forced) ||
    !matchesFlag(subtitle.hearingImpaired, stream.disposition?.hearing_impaired)
  )
    throw new Error(
      "Embedded subtitle stream identity disagrees with exact video inspection",
    );
  return stream.codec_name;
}

export async function subtitleFileEvidence(input: {
  scope: HandoffScope;
  file: HandoffFile;
  content: ContentProof;
  videoChecksum: string;
  codecs: Map<string, string | null>;
}) {
  const evidence: z.infer<typeof HandoffSubtitleEvidenceSchema>[] = [];
  for (const selected of input.scope.subtitles.filter(
    (item) => item.assetId === input.file.assetId,
  )) {
    const checksum =
      selected.canonicalPath === null
        ? null
        : await input.content.digest(selected.canonicalPath);
    if (
      selected.canonicalPath !== null &&
      (checksum === null ||
        (selected.capturedChecksum !== null &&
          selected.capturedChecksum !== checksum))
    )
      throw new Error("Subtitle content changed since source capture");
    evidence.push(
      HandoffSubtitleEvidenceSchema.parse({
        id: selected.id,
        assetId: selected.assetId,
        checksum,
        videoChecksum: input.videoChecksum,
        canonicalPath: selected.canonicalPath,
        storageKind: selected.canonicalPath === null ? "embedded" : "sidecar",
        streamIndex: selected.streamIndex,
        codec: input.codecs.get(selected.id) ?? null,
        qualityStatus: "unverified",
        reasons: ["legacy_quality_and_provenance_unverified"],
        identity:
          selected.canonicalPath === null
            ? null
            : await input.content.reviewIdentity(selected.canonicalPath),
      }),
    );
  }
  return evidence;
}

export async function adoptSubtitles(
  tx: Prisma.TransactionClient,
  input: {
    scope: HandoffScope;
    evidence: z.infer<typeof HandoffSubtitleEvidenceSchema>[];
    planId: string;
    actorId: string;
  },
) {
  for (const selected of input.scope.subtitles) {
    const evidence = input.evidence.find((item) => item.id === selected.id);
    const asset = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: selected.assetId },
    });
    if (evidence?.videoChecksum !== asset.checksum)
      throw new Error("Subtitle video content binding missing");
    const collisions = await tx.subtitleAsset.count({
      where: {
        OR: [
          ...(selected.canonicalPath === null
            ? []
            : [{ path: selected.canonicalPath }]),
          {
            assetId: selected.assetId,
            storageKind: "embedded",
            streamIndex: selected.streamIndex ?? -1,
          },
        ],
        state: { not: "purged" },
      },
    });
    if (collisions > 0)
      throw new Error(
        "Subtitle already tracked; explicit reconciliation required",
      );
    await tx.subtitleAsset.create({
      data: {
        id: selected.id,
        assetId: selected.assetId,
        language: selected.language,
        providerId: "migration",
        state: "installed",
        ownershipEpoch: input.scope.request.recoveryEpoch,
        qualityStatus: "unverified",
        storageKind: evidence.storageKind,
        path: selected.canonicalPath,
        checksum: evidence.checksum,
        videoChecksum: asset.checksum,
        videoVersion: asset.version,
        streamIndex: evidence.streamIndex,
        codec: evidence.codec,
        forced: selected.forced,
        hearingImpaired: selected.hearingImpaired,
        provenance: {
          ...selected,
          checksum: evidence.checksum,
          planId: input.planId,
          qualityReasons: evidence.reasons,
        },
        matchingEvidence: {
          assetId: asset.id,
          assetChecksum: asset.checksum,
          inspectedAssetVersion: asset.version,
          sourceInstanceId: selected.sourceInstanceId,
          sourceVideoPath: selected.sourceVideoPath,
          streamIndex: evidence.streamIndex,
          codec: evidence.codec,
          identity: evidence.identity,
        },
      },
    });
  }
  await lockSubtitlePolicies(tx);
  for (const policy of input.scope.subtitlePolicies) {
    for (const mediaId of policy.mediaIds) {
      const latest = await tx.mediaSubtitlePolicyVersion.findFirst({
        where: { mediaId },
        orderBy: { version: "desc" },
      });
      if ((latest?.version ?? -1) !== policy.expectedPolicyVersion)
        throw new Error("Subtitle policy changed after review");
      await tx.mediaSubtitlePolicyVersion.create({
        data: {
          mediaId,
          actorId: input.actorId,
          version: policy.expectedPolicyVersion + 1,
          recoveryEpoch: input.scope.request.recoveryEpoch,
          source: {
            planId: input.planId,
            provenanceKey: policy.provenanceKey,
            profile: policy.source,
            resolution: policy.resolution,
          },
          rules: policy.rules,
        },
      });
    }
  }
}
