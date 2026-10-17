import { defaultIntent } from "#shared/editions/scope.ts";
import { z } from "zod";
import { RemovalConfirmationSchema } from "#shared/contract.ts";
import { FileGuardError, type Transaction } from "./types.ts";

const OwnerOverrideSchema = RemovalConfirmationSchema.extend({
  ownerId: z.string(),
});

export async function assertOwnerRemoval(input: {
  tx: Transaction;
  evidence: unknown;
  mediaIds: readonly string[];
  purge: boolean;
}): Promise<void> {
  const { tx, mediaIds, purge } = input;
  const override = OwnerOverrideSchema.extend({
    operationId: z.string(),
  }).parse(input.evidence);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: override.operationId },
  });
  const payload = z
    .object({ action: z.literal("remove"), ownerOverride: OwnerOverrideSchema })
    .parse(operation.payload);
  const expected = {
    media: override.media,
    assets: override.assets,
    ownerId: override.ownerId,
  };
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: override.ownerId },
  });
  if (
    operation.kind !== "retain_media" ||
    operation.userId !== owner.id ||
    owner.role !== "owner" ||
    JSON.stringify(payload.ownerOverride) !== JSON.stringify(expected)
  )
    throw new FileGuardError("owner_override_invalid");
  const ids = override.media.map((item) => item.id);
  if (
    new Set(ids).size !== ids.length ||
    mediaIds.some((id) => !ids.includes(id))
  )
    throw new FileGuardError("owner_coverage_unconfirmed");
  const offset = purge ? 1 : 0;
  const media = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: { intents: { where: { edition: "default" } } },
  });
  if (
    media.length !== ids.length ||
    media.some((item) => {
      const snapshot = override.media.find((value) => value.id === item.id);
      return (
        snapshot === undefined ||
        item.version !== snapshot.version + offset ||
        defaultIntent(item.intents)?.generation !== snapshot.generation ||
        defaultIntent(item.intents)?.desiredPresence !== false
      );
    })
  )
    throw new FileGuardError("owner_confirmation_obsolete");
  const assets = await tx.libraryAsset.findMany({
    where: { coverage: { some: { mediaId: { in: ids }, current: true } } },
    include: { coverage: { where: { current: true } } },
  });
  if (
    assets.length !== override.assets.length ||
    assets.some((asset) => {
      const snapshot = override.assets.find((value) => value.id === asset.id);
      return (
        snapshot === undefined ||
        !asset.owned ||
        asset.version !== snapshot.version + offset ||
        asset.checksum !== snapshot.checksum ||
        asset.state !== (purge ? "quarantined" : "published") ||
        asset.coverage.some((item) => !ids.includes(item.mediaId))
      );
    })
  )
    throw new FileGuardError("owner_asset_confirmation_obsolete");
  if (
    (await tx.acquisitionReservation.findFirst({
      where: { mediaId: { in: ids }, edition: "default" },
    })) !== null
  )
    throw new FileGuardError("acquisition_active");
}
