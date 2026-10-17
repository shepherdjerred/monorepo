import nodePath from "node:path";
import { z } from "zod";
import {
  FileGuardError,
  type FileContext,
  type RemovalEntry,
  type Transaction,
} from "./types.ts";
import { assertRuntime } from "./guards.ts";

export async function recordRestoreReceipt(input: {
  tx: Transaction;
  context: FileContext;
  decisionId: string;
  operationId: string;
  mediaIds: string[];
  recoveryEpoch: number;
  plan: RemovalEntry[];
}): Promise<void> {
  const {
    tx,
    context,
    decisionId,
    operationId,
    mediaIds,
    recoveryEpoch,
    plan,
  } = input;
  await assertRuntime(tx, recoveryEpoch);
  const assets = [];
  for (const entry of plan) {
    const asset = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: entry.assetId },
      include: { coverage: { where: { current: true } } },
    });
    if (
      !asset.owned ||
      asset.state !== "published" ||
      asset.checksum !== entry.checksum ||
      asset.path !==
        nodePath.join(
          context.roots[entry.libraryKind].library,
          entry.libraryPath,
        ) ||
      asset.coverage.length !== entry.mediaIds.length ||
      asset.coverage.some(
        (coverage) => !entry.mediaIds.includes(coverage.mediaId),
      )
    )
      throw new FileGuardError("restore_asset_changed");
    assets.push({
      assetId: asset.id,
      assetVersion: asset.version,
      checksum: asset.checksum,
    });
  }
  const receipt = {
    restoreReceipt: { decisionId, mediaIds, recoveryEpoch, assets },
  };
  await tx.$executeRaw`UPDATE "Operation" SET "result" = COALESCE("result", '{}'::jsonb) || ${JSON.stringify(receipt)}::jsonb WHERE "id" = ${operationId}`;
}

export async function assertRestoredGenerations(
  tx: Transaction,
  mediaIds: string[],
  evidence: unknown,
): Promise<void> {
  const proof = z
    .object({ restoredGenerations: z.record(z.string(), z.number().int()) })
    .parse(evidence);
  const intents = await tx.mediaIntent.findMany({
    where: { mediaId: { in: mediaIds } },
  });
  if (
    intents.length !== mediaIds.length ||
    intents.some((intent) => {
      const restoredGeneration = proof.restoredGenerations[intent.mediaId];
      return (
        restoredGeneration === undefined ||
        !intent.desiredPresence ||
        intent.generation < restoredGeneration
      );
    })
  )
    throw new FileGuardError("restore_generation_changed");
}
