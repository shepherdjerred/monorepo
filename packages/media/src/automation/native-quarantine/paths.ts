import path from "node:path";
import type { NativeQuarantineFile } from "#shared/native-recovery/quarantine.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { safePath } from "#filesystem/operations-io.ts";
import { IdSchema } from "#filesystem/operations-types.ts";

export function quarantineParticipants(file: NativeQuarantineFile) {
  return [
    {
      subtitleId: null,
      libraryPath: file.libraryPath,
      quarantineId: file.quarantineId,
      checksum: file.checksum,
    },
    ...file.sidecars,
  ].map((participant) => ({
    ...participant,
    assetId: file.assetId,
    libraryKind: file.libraryKind,
    canonicalPath: path.posix.join(
      `/data/${file.libraryKind}`,
      participant.libraryPath,
    ),
    quarantinePath: `/data/${file.libraryKind}/.media-control/quarantine/${participant.quarantineId}`,
  }));
}
export type QuarantineParticipant = ReturnType<
  typeof quarantineParticipants
>[number];

/** Only configured roots translate canonical reviewed names into this executor's local paths. */
export async function quarantineLocalPaths(
  context: NativeFileContext,
  participant: QuarantineParticipant,
) {
  const roots = context.files.roots[participant.libraryKind];
  IdSchema.parse(participant.quarantineId);
  const canonical = await safePath(
    roots.library,
    participant.libraryPath,
    false,
  );
  const quarantined = await safePath(
    roots.control,
    `quarantine/${participant.quarantineId}`,
    false,
  );
  if (
    participant.canonicalPath !==
      `/data/${participant.libraryKind}/${participant.libraryPath}` ||
    participant.quarantinePath !==
      `/data/${participant.libraryKind}/.media-control/quarantine/${participant.quarantineId}`
  )
    throw new Error("Quarantine participant canonical path is inconsistent");
  return { canonical, quarantined };
}
