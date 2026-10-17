import { z } from "zod";
import type { Prisma, SubtitleReplacement } from "#generated/prisma/client.ts";
import { now, type FileContext } from "#automation/files/types.ts";
import { SubtitleReplacementSnapshotSchema } from "#shared/subtitle-replacement.ts";
import {
  currentSubtitleWork,
  subtitleTargetsReady,
} from "#automation/subtitles/authority.ts";
import { queueLifecycleNotifications } from "#automation/notifications/events.ts";
import { replacementPaths, type ReplacementProof } from "./files.ts";
import { artifactIdentity } from "./execution.ts";

export async function settleReplacement(
  tx: Prisma.TransactionClient,
  context: FileContext,
  row: SubtitleReplacement,
  input: {
    outcome: "installed" | "compensated" | "abandoned";
    proof: ReplacementProof;
  },
) {
  const { outcome, proof } = input;
  const scope = SubtitleReplacementSnapshotSchema.parse(row.snapshot);
  const paths = replacementPaths(context, row);
  if (outcome === "installed") {
    await tx.subtitleAsset.update({
      where: { id: row.oldSubtitleId },
      data: {
        state: "superseded",
        path: paths.oldArchive,
        version: { increment: 1 },
      },
    });
    await tx.subtitleAsset.update({
      where: { id: row.candidateSubtitleId },
      data: {
        state: "installed",
        path: scope.destination,
        version: { increment: 1 },
      },
    });
  } else {
    await tx.subtitleAsset.update({
      where: { id: row.candidateSubtitleId },
      data: { state: "failed", version: { increment: 1 } },
    });
  }
  const settledAt = now(context);
  const expires = new Date(settledAt.getTime() + 7 * 86_400_000);
  const artifacts = [];
  for (const name of [
    "source",
    "staged",
    "partial",
    "oldArchive",
    "rejected",
    "rollbackStaged",
  ] as const) {
    const filename = proof.paths[name];
    artifacts.push({
      name,
      path: filename,
      identity:
        (await proof.content.digest(filename)) === null
          ? null
          : await artifactIdentity(proof, filename),
    });
  }
  await tx.subtitleReplacementReceipt.create({
    data: {
      replacementId: row.id,
      outcome,
      evidence: {
        schemaVersion: 1,
        snapshotHash: row.snapshotHash,
        recoveryEpoch: row.recoveryEpoch,
        oldSubtitleId: row.oldSubtitleId,
        candidateSubtitleId: row.candidateSubtitleId,
        videoVersion: scope.asset.version,
        oldPath: scope.old.path,
        archivePath: paths.oldArchive,
        rejectedPath: paths.rejected,
        importOperationId: row.importOperationId,
        rollbackOperationId: row.rollbackOperationId,
        settledAt: settledAt.toISOString(),
        artifacts,
      },
    },
  });
  await tx.subtitleReplacement.update({
    where: { id: row.id },
    data: {
      state:
        outcome === "installed"
          ? "applied"
          : outcome === "compensated"
            ? "rolled_back"
            : "abandoned",
      reservationActive: false,
      reason: null,
      appliedAt: settledAt,
      archiveExpiresAt: expires,
      version: { increment: 1 },
    },
  });
  if (outcome !== "installed") return;
  const work = await currentSubtitleWork(tx, row.assetId, row.recoveryEpoch);
  if (!subtitleTargetsReady(work, row.recoveryEpoch)) return;
  await queueLifecycleNotifications(tx, {
    key: `subtitle-replaced:${row.id}`,
    kind: "subtitles_ready",
    epoch: row.recoveryEpoch,
    items: scope.asset.coverage.map((item) => ({
      mediaId: item.mediaId,
      generation: item.generation,
      assetId: scope.asset.id,
      assetVersion: scope.asset.version,
      assetChecksum: scope.asset.checksum,
      subtitleId: row.candidateSubtitleId,
      language: z.string().parse(scope.candidate.language),
    })),
  });
}
