import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const Selection = z.object({
  bindings: z.array(
    z.object({
      assetId: z.uuid(),
      assetVersion: z.int(),
      checksum: z.string(),
      mediaIds: z.array(z.uuid()),
      ownershipEpoch: z.int(),
    }),
  ),
});
type Asset = {
  id: string;
  version: number;
  checksum: string | null;
  state: string;
  owned: boolean;
  ownershipEpoch: number;
  coverage: { mediaId: string }[];
};

/** A native receipt proves this physical version only, never completeness of restored household intent. */
export async function currentNativeReceipts(
  tx: Prisma.TransactionClient,
  input: { assets: Asset[]; epoch: number },
) {
  if (input.assets.length === 0) return [];
  const rows = await tx.nativeRecoveryReceipt.findMany({
    where: {
      recoveryEpoch: input.epoch,
      OR: input.assets.map((asset) => ({
        selection: {
          path: ["bindings"],
          array_contains: [{ assetId: asset.id }],
        },
      })),
    },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Native household receipt history exceeds bounded lookup");
  const result = [];
  for (const row of rows) {
    const selection = Selection.parse(row.selection);
    if (
      row.plan.state !== "applied" ||
      row.plan.planHash !== row.planHash ||
      row.plan.plan === null ||
      snapshotHash(z.json().parse(row.plan.plan)) !== row.planHash
    )
      throw new Error("Native receipt has invalid immutable plan binding");
    const assetIds = input.assets
      .filter(
        (asset) =>
          asset.owned &&
          asset.state === "published" &&
          asset.ownershipEpoch === input.epoch &&
          selection.bindings.some(
            (binding) =>
              binding.assetId === asset.id &&
              binding.assetVersion === asset.version &&
              binding.checksum === asset.checksum &&
              binding.ownershipEpoch === input.epoch &&
              snapshotHash([...binding.mediaIds].sort()) ===
                snapshotHash(asset.coverage.map((item) => item.mediaId).sort()),
          ),
      )
      .map((asset) => asset.id);
    if (assetIds.length > 0)
      result.push({ id: row.id, planHash: row.planHash, assetIds });
  }
  return result;
}
