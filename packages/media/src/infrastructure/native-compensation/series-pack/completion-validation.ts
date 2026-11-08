import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { SeriesPackNativeDescriptorV2 } from "#shared/native-recovery/series-pack/evidence.ts";
import type { SeriesPackNativeCompletionV2 } from "#shared/native-recovery/series-pack/runtime.ts";

/** Historical consistency only. The real writer and SQL055 prove the effects,
 * rows and original parents; this never fabricates a current snapshot grant. */
export function assertSeriesPackNativeCompletionV1(record: {
  row: { recoveryEpoch: number };
  descriptor: SeriesPackNativeDescriptorV2;
  completion: SeriesPackNativeCompletionV2 | null;
}) {
  const { completion, descriptor, row } = record;
  if (completion === null) return;
  const scope = descriptor.scope;
  const entries = scope.publication.intent.entries;
  const { reservations: releasedReservations, ...settled } =
    scope.interruptedWork;
  if (
    completion.predecessorBindings.length !== entries.length ||
    new Set(completion.predecessorBindings.map((item) => item.before.id))
      .size !== entries.length ||
    identityHash(completion.settlement) !==
      identityHash({ ...settled, releasedReservations })
  )
    throw new Error("Native pack completion omitted whole literal settlement");
  for (const item of entries) {
    const before = item.predecessor;
    if (before === null)
      throw new Error("Native pack original predecessor missing");
    const binding = completion.predecessorBindings.find(
      (part) => part.before.id === before.id,
    );
    if (
      binding === undefined ||
      identityHash(binding.before) !== identityHash(before) ||
      identityHash(binding.after) !==
        identityHash({
          ...before,
          version: before.version + 1,
          ownershipEpoch: row.recoveryEpoch,
          subtitles: before.subtitles.map((subtitle) => ({
            ...subtitle,
            version: subtitle.version + 1,
            ownershipEpoch: row.recoveryEpoch,
            videoVersion: before.version + 1,
          })),
        })
    )
      throw new Error(
        "Native pack completion changed physical identity or invented a row version",
      );
    const expected = [
      {
        subtitleId: null,
        role: "video",
        path: item.entry.libraryPath,
        checksum: before.checksum,
      },
      ...item.entry.previousSidecars.map((sidecar) => ({
        subtitleId: sidecar.subtitleId,
        role: "sidecar",
        path: sidecar.libraryPath,
        checksum: before.subtitles.find(
          (subtitle) => subtitle.id === sidecar.subtitleId,
        )?.checksum,
      })),
    ];
    if (
      binding.participants.length !== expected.length ||
      new Set(binding.participants.map((part) => part.subtitleId)).size !==
        expected.length ||
      binding.participants.some(
        (part) =>
          part.assetId !== before.id ||
          part.libraryKind !== "tv" ||
          part.physical.root !== "library" ||
          part.physical.state !== "present" ||
          !expected.some(
            (wanted) =>
              wanted.subtitleId === part.subtitleId &&
              wanted.role === part.role &&
              wanted.path === part.physical.path &&
              part.physical.state === "present" &&
              wanted.checksum === part.physical.sha256,
          ),
      )
    )
      throw new Error(
        "Native pack completion lost exact original restored participants",
      );
  }
}
