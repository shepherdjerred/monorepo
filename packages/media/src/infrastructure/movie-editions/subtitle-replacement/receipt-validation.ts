import { z } from "zod";
import type {
  Operation,
  SubtitleReplacement,
} from "#generated/prisma/client.ts";
import type {
  MovieReplacementSnapshotV2,
  MovieReplacementReceiptV2,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

export function assertMovieReplacementReceiptBindingV2(
  row: SubtitleReplacement,
  snapshot: MovieReplacementSnapshotV2,
  receipt: MovieReplacementReceiptV2,
  command: Operation,
) {
  const payload = z
    .object({ replacementId: z.uuid(), movieScope: MovieEditionScopeSchema })
    .parse(command.payload);
  const actual = {
    snapshotHash: receipt.snapshotHash,
    scope: receipt.scope,
    epoch: receipt.recoveryEpoch,
    old: receipt.oldSubtitleId,
    candidate: receipt.candidateSubtitleId,
    videoVersion: receipt.videoVersion,
    destination: receipt.oldPath,
    importId: receipt.importOperationId,
    rollbackId: receipt.rollbackOperationId,
    source: receipt.source,
    before: receipt.before,
    command: receipt.command,
  };
  const expected = {
    snapshotHash: row.snapshotHash,
    scope: snapshot.scope,
    epoch: row.recoveryEpoch,
    old: row.oldSubtitleId,
    candidate: row.candidateSubtitleId,
    videoVersion: snapshot.asset.version,
    destination: snapshot.destination,
    importId: row.importOperationId,
    rollbackId: row.rollbackOperationId,
    source: snapshot.source,
    before: { old: snapshot.old, candidate: snapshot.candidate },
    command: {
      operationId: command.id,
      kind: command.kind,
      actorId: command.userId,
      payloadHash: hash(command.payload),
    },
  };
  if (
    hash(actual) !== hash(expected) ||
    command.targetId !== row.id ||
    payload.replacementId !== row.id ||
    hash(payload.movieScope) !== hash(snapshot.scope)
  )
    throw new Error(
      "Movie caption replacement lost its exact immutable source",
    );
}

export function assertMovieReplacementReceiptTransitionV2(
  row: SubtitleReplacement & { receipt: { outcome: string } },
  snapshot: MovieReplacementSnapshotV2,
  receipt: MovieReplacementReceiptV2,
) {
  const installed = row.receipt.outcome === "installed";
  const candidate = installed
    ? {
        ...snapshot.candidate,
        version: snapshot.candidate.version + 1,
        state: "installed",
        path: snapshot.destination,
        matchingEvidence: {
          ...z
            .record(z.string(), z.json())
            .parse(snapshot.candidate.matchingEvidence),
          movieReplacementV2: { schemaVersion: 2, replacementId: row.id },
        },
      }
    : {
        ...snapshot.candidate,
        version: snapshot.candidate.version + 1,
        state: "failed",
      };
  const old = installed
    ? {
        ...snapshot.old,
        version: snapshot.old.version + 1,
        state: "superseded",
        path: receipt.archivePath,
      }
    : snapshot.old;
  const observed = Date.parse(receipt.observedAt);
  const settled = Date.parse(receipt.settledAt);
  const expires = Date.parse(receipt.expiresAt);
  if (
    hash(receipt.after) !== hash({ old, candidate }) ||
    settled < observed ||
    settled >= expires ||
    expires > Math.min(Date.parse(receipt.sdkExpiresAt), observed + 60_000)
  )
    throw new Error(
      "Movie caption replacement changed its actual transition or deadline",
    );
  if (
    installed &&
    (receipt.journal?.phase !== "complete" ||
      receipt.journal.kind !== "import" ||
      receipt.journal.operationId !== row.importOperationId ||
      receipt.journal.target !== snapshot.destination ||
      receipt.journal.sha256 !== snapshot.candidate.checksum ||
      receipt.journal.previousSha256 !== snapshot.old.checksum)
  )
    throw new Error(
      "Movie caption replacement lost its actual complete native journal",
    );
}
