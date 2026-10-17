import path from "node:path";
import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  BundleReportSchema,
  MigrationBundleSchema,
} from "#shared/migration-handoff.ts";
import type { HandoffScope, PrepareHandoffSchema } from "#shared/handoff.ts";
import { HandoffSubtitleSchema } from "#shared/subtitle-handoff.ts";
import { translateSubtitlePolicy } from "#domain/subtitle-policy.ts";

type Entry = z.infer<typeof BundleReportSchema>["entries"][number];
type Manifest = z.infer<typeof MigrationBundleSchema>;
export async function projectHandoffSubtitles(input: {
  tx: Prisma.TransactionClient;
  request: z.infer<typeof PrepareHandoffSchema>;
  manifest: Manifest;
  selected: Entry[];
  files: HandoffScope["files"];
}) {
  const subtitles: HandoffScope["subtitles"] = [];
  const policies: HandoffScope["subtitlePolicies"] = [];
  for (const entry of input.selected) {
    if (entry.sourceRecord.kind === "subtitle") {
      const subtitle = projectSubtitle(entry, input.manifest, input.files);
      mergeSubtitle(subtitles, subtitle);
    }
    if (entry.sourceRecord.kind === "subtitle_preference") {
      policies.push(await projectPolicy(input, entry));
    }
  }
  for (const subtitle of subtitles) {
    const mediaIds = new Set(
      input.selected
        .filter((entry) =>
          subtitle.provenanceKeys.includes(entry.provenanceKey),
        )
        .flatMap((entry) => entry.mediaIds),
    );
    const file = input.files.find((item) => item.assetId === subtitle.assetId);
    if (
      file === undefined ||
      file.mediaIds.some((id) => !mediaIds.has(id)) ||
      mediaIds.size !== file.mediaIds.length
    )
      throw new Error(
        "Shared video subtitle coverage requires every exact source episode association",
      );
  }
  if (
    new Set(policies.flatMap((item) => item.mediaIds)).size !==
    policies.flatMap((item) => item.mediaIds).length
  )
    throw new Error("Conflicting subtitle policies for selected media");
  return { subtitles, subtitlePolicies: policies };
}

function mergeSubtitle(
  subtitles: HandoffScope["subtitles"],
  subtitle: HandoffScope["subtitles"][number],
) {
  const previous = subtitles.find(
    (item) =>
      item.assetId === subtitle.assetId &&
      item.canonicalPath === subtitle.canonicalPath &&
      item.streamIndex === subtitle.streamIndex,
  );
  if (previous === undefined) {
    subtitles.push(subtitle);
    return;
  }
  if (
    previous.language !== subtitle.language ||
    previous.forced !== subtitle.forced ||
    previous.hearingImpaired !== subtitle.hearingImpaired ||
    previous.capturedChecksum !== subtitle.capturedChecksum
  )
    throw new Error("Conflicting subtitle observations for shared video");
  previous.provenanceKeys.push(...subtitle.provenanceKeys);
}

async function projectPolicy(
  input: Parameters<typeof projectHandoffSubtitles>[0],
  entry: Entry,
) {
  if (entry.sourceRecord.kind !== "subtitle_preference")
    throw new Error("Expected subtitle policy");
  requireManager(entry, input.manifest);
  const source = entry.sourceRecord.sourceProfile;
  const resolution = input.request.subtitlePolicies.find(
    (item) => item.provenanceKey === entry.provenanceKey,
  );
  if (source == null || resolution === undefined)
    throw new Error(
      "Subtitle policy needs an explicit owner resolution and version",
    );
  for (const mediaId of entry.mediaIds) {
    const current = await input.tx.mediaSubtitlePolicyVersion.findFirst({
      where: { mediaId },
      orderBy: { version: "desc" },
    });
    if ((current?.version ?? -1) !== resolution.expectedPolicyVersion)
      throw new Error("Subtitle policy version changed");
  }
  return {
    provenanceKey: entry.provenanceKey,
    mediaIds: entry.mediaIds,
    expectedPolicyVersion: resolution.expectedPolicyVersion,
    source,
    resolution: resolution.chinese,
    rules: translateSubtitlePolicy(source, resolution.chinese),
  };
}

function requireManager(entry: Entry, manifest: Manifest) {
  const record = entry.sourceRecord;
  if (record.kind !== "subtitle" && record.kind !== "subtitle_preference")
    throw new Error("Expected subtitle record");
  const reference = record.managerReference;
  const matching = manifest.captures.filter(
    (capture) =>
      capture.sourceKind === reference?.kind &&
      capture.sourceInstanceId === reference.sourceInstanceId,
  );
  const manager = matching[0];
  if (
    manager === undefined ||
    matching.length !== 1 ||
    reference?.binding !== "owner_declared" ||
    reference.sourceInstanceId === null
  )
    throw new Error("Subtitle manager instance is unbound or ambiguous");
  return manager;
}

function projectSubtitle(
  entry: Entry,
  manifest: Manifest,
  files: HandoffScope["files"],
) {
  const record = entry.sourceRecord;
  if (record.kind !== "subtitle") throw new Error("Expected subtitle");
  const manager = requireManager(entry, manifest);
  const matching = files.filter(
    (file) =>
      file.captureId === manager.captureId &&
      file.sourcePath === record.videoPath &&
      entry.mediaIds.every((id) => file.mediaIds.includes(id)),
  );
  const file = matching[0];
  if (file === undefined || matching.length !== 1)
    throw new Error("Subtitle has no exact selected source video");
  const streamIndex = record.embeddedTrackId ?? null;
  let canonicalPath: string | null = null;
  if (record.path !== null) {
    if (streamIndex !== null || !/\.(?:srt|ass|ssa|vtt)$/iu.test(record.path))
      throw new Error("Subtitle storage shape unsupported");
    const mappings = manifest.rootMappings.filter(
      (item) =>
        item.captureId === manager.captureId &&
        record.path?.startsWith(`${item.sourceRoot.replace(/\/$/u, "")}/`) ===
          true,
    );
    const mapping = mappings[0];
    if (mapping === undefined || mappings.length !== 1)
      throw new Error("Subtitle root mapping ambiguous");
    const relative = path.relative(mapping.sourceRoot, record.path);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Subtitle path escapes source root");
    canonicalPath = path.join(mapping.canonicalRoot, relative);
    if (canonicalPath === file.canonicalPath)
      throw new Error("Subtitle cannot be the video file");
  } else if (streamIndex === null)
    throw new Error("Subtitle storage identity missing");
  return HandoffSubtitleSchema.parse({
    id: crypto.randomUUID(),
    assetId: file.assetId,
    provenanceKeys: [entry.provenanceKey],
    managerCaptureId: manager.captureId,
    sourceInstanceId: manager.sourceInstanceId,
    sourceVideoPath: file.sourcePath,
    sourcePath: record.path,
    canonicalPath,
    capturedChecksum: record.checksum,
    language: record.language,
    forced: record.forced ?? null,
    hearingImpaired: record.hearingImpaired ?? null,
    streamIndex,
  });
}
