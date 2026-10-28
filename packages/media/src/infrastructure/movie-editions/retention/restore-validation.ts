import { createHash } from "node:crypto";
import { z } from "zod";
import type { MovieRestoreReceiptV1 } from "#shared/movie-editions/restore-v1.ts";
import type { MovieQuarantinePlexReceiptV2 } from "#shared/movie-editions/quarantine-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Literal snapshots and actual journals establish one exact video/caption transition. */
export function assertMovieRestoreReceiptV1(
  receipt: MovieRestoreReceiptV1,
  parent: MovieQuarantinePlexReceiptV2,
) {
  const { before, after } = receipt;
  const original = parent.groups[0];
  const entry = receipt.manifest.assets[0];
  if (
    identityHash(receipt.scope) !== identityHash(receipt.input.scope) ||
    identityHash(receipt.scope) !== identityHash(parent.scope) ||
    receipt.quarantine.operationId !== parent.operationId ||
    receipt.quarantine.decisionId !== parent.decisionId ||
    receipt.quarantine.manifestHash !== parent.manifestHash ||
    identityHash(receipt.manifest) !== parent.manifestHash ||
    before.state !== "quarantined" ||
    after.state !== "published" ||
    before.id !== original.assetId ||
    entry.assetId !== original.assetId ||
    before.version !== original.assetVersion + 1 ||
    after.version !== before.version + 1 ||
    before.checksum !== original.checksum ||
    before.sizeBytes !== original.sizeBytes ||
    before.path !== original.canonicalPath ||
    before.ownershipEpoch !== parent.recoveryEpoch
  )
    throw new Error("Movie restore lost its exact quarantined physical parent");
  assertRestoreVideo(receipt);
  assertRestoreCaptions(receipt);
  assertRestoreEvidence(receipt);
  const observed = Date.parse(receipt.observedAt),
    committed = Date.parse(receipt.committedAt),
    expires = Date.parse(receipt.expiresAt);
  if (
    committed < observed ||
    committed >= expires ||
    expires > Math.min(Date.parse(receipt.sdkExpiresAt), observed + 60_000)
  )
    throw new Error("Movie restore original invocation deadline changed");
}

function assertRestoreVideo({ before, after, scope }: MovieRestoreReceiptV1) {
  const {
    version,
    state: _state,
    subtitles: _subtitles,
    subtitleHistory: _history,
    ...video
  } = before;
  const {
    version: _afterVersion,
    state: _afterState,
    subtitles: _afterSubtitles,
    subtitleHistory: _afterHistory,
    ...restored
  } = after;
  if (
    identityHash(video) !== identityHash(restored) ||
    identityHash(before.scope) !== identityHash(scope) ||
    before.editionRootId !== scope.rootMediaId ||
    before.edition !== scope.edition ||
    !before.coverage[0].current ||
    before.coverage[0].mediaId !== scope.mediaId ||
    before.coverage[0].edition !== scope.edition ||
    after.version !== version + 1
  )
    throw new Error("Movie restore changed immutable video facts or scope");
}

function assertRestoreCaptions({
  before,
  after,
  manifest,
}: MovieRestoreReceiptV1) {
  const rows = [...before.subtitles, ...before.subtitleHistory];
  const restored = new Map(
    [...after.subtitles, ...after.subtitleHistory].map((row) => [row.id, row]),
  );
  if (
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    restored.size !== rows.length
  )
    throw new Error("Movie restore caption inventory changed");
  for (const caption of before.subtitles) {
    if (
      caption.state !== "quarantined" ||
      caption.assetId !== before.id ||
      caption.videoVersion !== before.version ||
      caption.videoChecksum !== before.checksum ||
      caption.ownershipEpoch !== before.ownershipEpoch ||
      identityHash({
        ...caption,
        version: caption.version + 1,
        state: "installed",
        videoVersion: after.version,
      }) !== identityHash(restored.get(caption.id))
    )
      throw new Error("Movie restore caption transition changed");
  }
  for (const caption of before.subtitleHistory)
    if (identityHash(caption) !== identityHash(restored.get(caption.id)))
      throw new Error("Movie restore changed independent caption history");
  const sidecars = before.subtitles.filter(
    (row) => row.storageKind === "sidecar",
  );
  if (
    sidecars.length !== manifest.assets[0].sidecars.length ||
    manifest.assets[0].sidecars.some(
      (item) =>
        !sidecars.some(
          (row) =>
            row.id === item.subtitleId &&
            row.checksum === item.checksum &&
            row.path === `/data/movies/${item.libraryPath}`,
        ),
    )
  )
    throw new Error("Movie restore omitted an owned sidecar");
}

function assertRestoreEvidence(receipt: MovieRestoreReceiptV1) {
  const entry = receipt.manifest.assets[0];
  const files = [{ ...entry, subtitleId: null }, ...entry.sidecars];
  if (
    receipt.journals.length !== files.length ||
    receipt.participants.length !== files.length * 2
  )
    throw new Error("Movie restore physical evidence coverage changed");
  for (const file of files) {
    const operationId = `${receipt.input.operationId}-restore-${file.quarantineId}`;
    const journal = receipt.journals.find(
      (row) => row.path === `journal/${operationId}.json`,
    );
    if (journal === undefined)
      throw new Error("Movie restore literal journal changed");
    if (
      createHash("sha256").update(journal.raw).digest("hex") !==
        journal.sha256 ||
      Buffer.byteLength(journal.raw).toString() !== journal.sizeBytes
    )
      throw new Error("Movie restore literal journal changed");
    const manifest = z
      .object({
        version: z.literal(1),
        operationId: z.string(),
        kind: z.literal("restore"),
        phase: z.literal("complete"),
        sha256: z.string(),
        source: z.string(),
        target: z.string(),
        previousSha256: z.null(),
      })
      .parse(JSON.parse(journal.raw));
    if (
      manifest.operationId !== operationId ||
      manifest.sha256 !== file.checksum ||
      !manifest.source.endsWith(`/quarantine/${file.quarantineId}`) ||
      !manifest.target.endsWith(`/${file.libraryPath}`)
    )
      throw new Error("Movie restore journal lost its actual scoped paths");
    const participants = receipt.participants.filter(
      (row) =>
        row.assetId === entry.assetId && row.subtitleId === file.subtitleId,
    );
    if (
      participants.length !== 2 ||
      !participants.some(
        (row) =>
          row.libraryKind === "movies" &&
          row.physical.root === "library" &&
          row.physical.path === file.libraryPath &&
          row.physical.state === "present" &&
          row.physical.sha256 === file.checksum,
      ) ||
      !participants.some(
        (row) =>
          row.libraryKind === "movies" &&
          row.role === "quarantine" &&
          row.physical.root === "control" &&
          row.physical.path === `quarantine/${file.quarantineId}` &&
          row.physical.state === "absent",
      )
    )
      throw new Error("Movie restore actual physical participants changed");
  }
}
