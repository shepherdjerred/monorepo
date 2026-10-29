import type { ContentProof } from "#filesystem/content-proof.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  inspectHandoffJournals,
  type JournalProof,
} from "#automation/handoff/journals.ts";
import { unmanagedSidecars } from "#automation/handoff/sidecars.ts";
import {
  NativeQuarantineParticipantEvidenceSchema,
  type NativeQuarantineScope,
  type NativeQuarantineFile,
} from "#shared/native-recovery/quarantine.ts";
import { NativeSubtitleEvidenceSchema } from "#shared/native-subtitles.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { nativeEmbeddedStream } from "#automation/native-subtitles/proof.ts";
import { assertQuarantinedSubtitleBindings } from "./subtitles.ts";
import {
  quarantineParticipants,
  quarantineLocalPaths,
  type QuarantineParticipant,
} from "./paths.ts";
import { originalQuarantineOperation } from "./journals.ts";

type LocalParticipant = {
  participant: QuarantineParticipant;
  canonical: string;
  quarantined: string;
};
export type CapturedQuarantineParticipant = LocalParticipant & {
  quarantineOperationId: string;
};

export async function inspectQuarantineRoot(
  context: NativeFileContext,
  scope: NativeQuarantineScope,
  kind: "movies" | "tv",
  content: ContentProof,
) {
  const files = scope.files.filter((file) => file.libraryKind === kind);
  const local: LocalParticipant[] = [];
  for (const participant of files.flatMap((file) =>
    quarantineParticipants(file),
  ))
    local.push({
      participant,
      ...(await quarantineLocalPaths(context, participant)),
    });
  if (
    new Set(local.flatMap((item) => [item.canonical, item.quarantined]))
      .size !==
    local.length * 2
  )
    throw new Error("Quarantine physical paths collide");
  const journal = await inspectHandoffJournals(
    context.files.roots[kind].control,
    new Set(local.flatMap((item) => [item.canonical, item.quarantined])),
  );
  const captured: CapturedQuarantineParticipant[] = [];
  for (const item of local) {
    for (const filename of [item.canonical, item.quarantined])
      await content.capture(filename, () =>
        context.files.checkpoint("native-quarantine-hashing"),
      );
    captured.push({
      ...item,
      quarantineOperationId: await originalQuarantineOperation({
        db: context.files.db,
        scope,
        journal,
        ...item,
      }),
    });
  }
  const embedded = [];
  for (const file of files)
    embedded.push(...(await inspectQuarantineEmbedded(context, file, local)));
  return { captured, embedded, journal };
}

async function inspectQuarantineEmbedded(
  context: NativeFileContext,
  file: NativeQuarantineFile,
  local: LocalParticipant[],
) {
  assertQuarantinedSubtitleBindings(file);
  const video = local.find(
    (item) =>
      item.participant.assetId === file.assetId &&
      item.participant.subtitleId === null,
  );
  if (video === undefined)
    throw new Error("Quarantine video participant missing");
  const neighbors = await unmanagedSidecars(video.canonical);
  if (neighbors.length > 0)
    throw new Error(
      "Quarantined video has unknown canonical sidecar neighbors",
    );
  const probe = await (context.files.inspect ?? inspectMedia)(
    video.quarantined,
  );
  if (!probe.streams.some((stream) => stream.codec_type === "video"))
    throw new Error("Quarantine video has no measured video stream");
  return file.subtitles
    .filter((item) => item.storageKind === "embedded")
    .map((subtitle) =>
      NativeSubtitleEvidenceSchema.parse({
        id: subtitle.id,
        assetId: file.assetId,
        snapshotHash: snapshotHash(subtitle),
        videoChecksum: file.checksum,
        canonicalPath: null,
        checksum: subtitle.checksum,
        sizeBytes: null,
        identity: null,
        storageKind: "embedded",
        qualityStatus: subtitle.qualityStatus,
        stream: nativeEmbeddedStream(probe, subtitle),
      }),
    );
}

export async function captureQuarantineGroups(
  context: NativeFileContext,
  scope: NativeQuarantineScope,
  captured: CapturedQuarantineParticipant[],
) {
  const groups = [];
  const proofs: JournalProof[] = [];
  for (const group of scope.groups) {
    const journals = [];
    for (const libraryKind of ["movies", "tv"] as const) {
      const selected = captured.filter(
        (item) =>
          item.participant.libraryKind === libraryKind &&
          group.assetIds.includes(item.participant.assetId),
      );
      if (selected.length === 0) continue;
      const journal = await inspectHandoffJournals(
        context.files.roots[libraryKind].control,
        new Set(selected.flatMap((item) => [item.canonical, item.quarantined])),
      );
      proofs.push(journal);
      journals.push({ libraryKind, digest: journal.digest });
    }
    groups.push({ groupHash: group.groupHash, journals });
  }
  return { groups, proofs };
}

export async function quarantineParticipantEvidence(
  content: ContentProof,
  scope: NativeQuarantineScope,
  item: CapturedQuarantineParticipant,
) {
  if ((await content.digest(item.canonical)) !== null)
    throw new Error("Quarantined canonical destination exists");
  const proof = await content.verifiedFile(item.quarantined);
  const file = scope.files.find(
    (candidate) => candidate.assetId === item.participant.assetId,
  );
  if (
    file === undefined ||
    proof.sha256 !== item.participant.checksum ||
    (item.participant.subtitleId === null
      ? proof.sizeBytes !== file.sizeBytes
      : BigInt(proof.sizeBytes) > 8n * 1024n * 1024n)
  )
    throw new Error(
      "Quarantined participant bytes differ from committed identity",
    );
  return NativeQuarantineParticipantEvidenceSchema.parse({
    ...item.participant,
    checksum: proof.sha256,
    sizeBytes: proof.sizeBytes,
    identity: await content.reviewIdentity(item.quarantined),
    canonicalAbsence: await content.reviewAbsence(item.canonical),
    quarantineOperationId: item.quarantineOperationId,
  });
}
