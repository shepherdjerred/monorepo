import path from "node:path";
import { z } from "zod";
import {
  HandoffFileEvidenceSchema,
  type HandoffScope,
  type HandoffFile,
} from "#shared/handoff.ts";
import {
  HandoffScopeProtocolSchema,
  HandoffNetworkProtocolSchema,
  type HandoffProtocolScope,
  assertHandoffNetworkProtocol,
} from "#shared/handoff/protocol.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { safePath, verifyControlExclusion } from "#filesystem/operations-io.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { probeAttributes } from "#automation/files/inspection.ts";
import type { FileContext } from "#automation/files/types.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { inspectHandoffJournals, type JournalProof } from "./journals.ts";
import { ResolvedEvidenceSchema } from "#domain/resolved-evidence.ts";
import { collectResolvedEvidence } from "#migration/runtime-evidence.ts";
import { unmanagedSidecars } from "./sidecars.ts";
import { captureHandoffSubtitles, subtitleFileEvidence } from "./subtitles.ts";

export type HandoffFileContext = { files: FileContext; workerPodUid: string };
export type PreparedHandoffFiles = {
  scope: HandoffProtocolScope;
  content: ContentProof;
  journals: JournalProof[];
  evidence: z.infer<typeof HandoffFileEvidenceSchema>;
};

/** Read-only proof generation. The content capability never leaves this Activity process. */
export async function prepareHandoffFiles(
  context: HandoffFileContext,
  planId: string,
  focusAssetId?: string,
): Promise<PreparedHandoffFiles> {
  const db = context.files.db;
  const plan = await db.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  if (!["preparing", "applying"].includes(plan.state))
    throw new Error("Handoff file proof has no live owner command");
  const scope = HandoffScopeProtocolSchema.parse(plan.scope);
  assertFocus(scope, focusAssetId);
  if (
    new Set(scope.files.map((file) => file.canonicalPath)).size !==
      scope.files.length ||
    new Set(scope.files.map((file) => file.assetId)).size !== scope.files.length
  )
    throw new Error("Handoff file selection has duplicate identities");
  const observation = await db.mediaHandoffObservation.findFirstOrThrow({
    where: { planId, kind: "network" },
    orderBy: { createdAt: "desc" },
  });
  const network = HandoffNetworkProtocolSchema.parse(observation.evidence);
  assertHandoffNetworkProtocol(scope, network);
  if (
    network.recoveryEpoch !== plan.recoveryEpoch ||
    network.planId !== planId ||
    observation.expiresAt <= new Date()
  )
    throw new Error("Handoff network evidence is stale");
  const content = new ContentProof();
  const journals: JournalProof[] = [];
  const measured = [];
  for (const kind of ["movies", "tv"] as const) {
    const root = context.files.roots[kind];
    await verifyControlExclusion(root, context.files.verifyPlexExclusion);
    // Initialize only our advisory-lock directory before recording an absent journal's parent identity.
    await safePath(root.control, "locks/handoff-proof.lock", true);
    const binding = network.mounts.bindings.find(
      (item) => item.canonical.root === root.library,
    );
    if (binding?.canonical.podUid !== context.workerPodUid)
      throw new Error("Handoff mount proof belongs to another files executor");
    const selected = selectedFiles(scope, kind, focusAssetId);
    const journal = await inspectHandoffJournals(
      root.control,
      new Set(selected.map((item) => item.canonicalPath)),
    );
    journals.push(journal);
    for (const file of selected) {
      const relative = path.relative(root.library, file.canonicalPath);
      const target = await safePath(root.library, relative, false);
      if (target !== file.canonicalPath)
        throw new Error("Handoff target does not match canonical root");
      await content.capture(target, () =>
        context.files.checkpoint("handoff-file-hashing"),
      );
      const measurement = await measuredProperties(context.files, scope, file);
      measured.push({
        file,
        properties: measurement.properties,
        codecs: await captureHandoffSubtitles({
          context: context.files,
          scope,
          file,
          content,
          probe: measurement.probe,
        }),
        journalDigest: journal.digest,
      });
    }
  }
  content.seal();
  const files = [];
  for (const item of measured) {
    const proof = await content.verifiedFile(item.file.canonicalPath);
    if (
      proof.sizeBytes !== item.file.sizeBytes ||
      (item.file.capturedChecksum !== null &&
        proof.sha256 !== item.file.capturedChecksum)
    )
      throw new Error("Handoff source content changed since capture");
    files.push({
      assetId: item.file.assetId,
      canonicalPath: item.file.canonicalPath,
      checksum: proof.sha256,
      sizeBytes: proof.sizeBytes,
      identity: await content.reviewIdentity(item.file.canonicalPath),
      properties: item.properties,
      journalDigest: item.journalDigest,
      unmanagedSidecars: await unmanagedSidecars(item.file.canonicalPath),
      subtitles: await subtitleFileEvidence({
        scope,
        file: item.file,
        content,
        videoChecksum: proof.sha256,
        codecs: item.codecs,
      }),
    });
  }
  const evidence = HandoffFileEvidenceSchema.parse({
    schemaVersion: 1,
    planId,
    recoveryEpoch: plan.recoveryEpoch,
    workerPodUid: context.workerPodUid,
    capturedAt: new Date().toISOString(),
    files,
  });
  return { scope, content, journals, evidence };
}

function assertFocus(
  scope: HandoffProtocolScope,
  assetId: string | undefined,
): void {
  if (assetId === undefined) return;
  if (
    !("schemaVersion" in scope) ||
    scope.schemaVersion !== 3 ||
    scope.files.filter((file) => file.assetId === assetId).length !== 1
  )
    throw new Error(
      "Focused file proof requires one selected v3 library asset",
    );
}
function selectedFiles(
  scope: HandoffProtocolScope,
  kind: "movies" | "tv",
  assetId: string | undefined,
) {
  return scope.files.filter(
    (file) =>
      file.libraryKind === kind &&
      (assetId === undefined || file.assetId === assetId),
  );
}

async function measuredProperties(
  context: FileContext,
  scope: HandoffScope,
  file: HandoffFile,
) {
  const probe = await (context.inspect ?? inspectMedia)(file.canonicalPath);
  const selected = scope.media.filter((item) =>
    file.mediaIds.includes(item.mediaId),
  );
  const profileIds = [
    ...new Set(
      selected.flatMap((item) =>
        item.profileId === null ? [] : [item.profileId],
      ),
    ),
  ];
  if (
    profileIds.length !== 1 ||
    selected.some((item) => item.profileId === null)
  )
    throw new Error("Handoff file needs one exact resolved profile binding");
  const profile = await context.db.qualityProfile.findUniqueOrThrow({
    where: { id: z.string().parse(profileIds[0]) },
  });
  if (selected.some((item) => item.profileVersion !== profile.version))
    throw new Error("Handoff profile version changed");
  const resolved = QualityRulesSchema.parse(profile.rules).resolved;
  const quality = resolved?.qualityDefinitions.find(
    (item) => String(item.quality.id) === file.qualitySourceId,
  )?.quality;
  if (quality === undefined || resolved === undefined)
    throw new Error("Handoff source quality mapping is unproven");
  const measured = probeAttributes(probe, quality.name);
  if (!measured.quality.endsWith(`${String(quality.resolution)}p`))
    throw new Error(
      "Handoff measured video resolution conflicts with source quality",
    );
  const media = await context.db.mediaItem.findMany({
    where: { id: { in: file.mediaIds } },
  });
  const languages = new Set(media.map((item) => item.originalLanguage));
  const runtimeMinutes = media.every((item) => item.runtimeMinutes !== null)
    ? media.reduce((sum, item) => sum + (item.runtimeMinutes ?? 0), 0)
    : null;
  const evidence = ResolvedEvidenceSchema.parse({
    schemaVersion: 1,
    source: resolved.source,
    sourceVersion: resolved.sourceVersion,
    parserVersion: "handoff-v1",
    release: {
      id: `handoff:${file.assetId}`,
      qualityId: quality.id,
      identityConfirmed: true,
      releaseTitle: null,
      filename: path.basename(file.canonicalPath),
      releaseGroup: null,
      sizeBytes: Number(file.sizeBytes),
      runtimeMinutes,
      audioLanguages:
        measured.audioLanguages.length === 0 ? null : measured.audioLanguages,
      originalLanguage:
        languages.size === 1 ? (media[0]?.originalLanguage ?? null) : null,
      revision: null,
      specialEpisode: media.every((item) => item.seasonNumber === 0),
    },
    protectedReasons: [],
    regex: { engine: "dotnet-ignorecase", culture: "en-US", observations: [] },
  });
  const resolvedEvidence = await collectResolvedEvidence(resolved, evidence);
  return {
    probe,
    properties: {
      id: `handoff:${file.assetId}`,
      providerId: "migration",
      title: path.basename(file.canonicalPath),
      mediaIds: file.mediaIds,
      identityConfidence: "exact" as const,
      quality: measured.quality,
      codec: measured.codec,
      audioLanguages: measured.audioLanguages,
      sizeBytes: Number(file.sizeBytes),
      scoreTags: [],
      resolvedEvidence,
    },
  };
}
