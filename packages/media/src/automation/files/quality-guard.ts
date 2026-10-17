import { chooseUpgrade } from "#domain/quality.ts";
import {
  PublicReleaseAttributesSchema,
  QualityRulesSchema,
} from "#shared/api.ts";
import type { ReleaseAttributes } from "#shared/contract.ts";
import { FileGuardError, type Transaction } from "./types.ts";
import { z } from "zod";

const StoredReleaseSchema = PublicReleaseAttributesSchema.extend({
  id: z.string(),
  providerId: z.string(),
  title: z.string(),
});

export async function assertMeasuredUpgrade(
  db: Pick<Transaction, "mediaIntent" | "assetCoverage">,
  measured: ReleaseAttributes,
  mediaIds: readonly string[],
  publishedAssetId?: string,
): Promise<Record<string, number>> {
  const profileVersions: Record<string, number> = {};
  for (const mediaId of mediaIds) {
    const intent = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId },
      include: { profile: true },
    });
    if (intent.profile === null) throw new FileGuardError("profile_missing");
    const profile = {
      ...QualityRulesSchema.parse(intent.profile.rules),
      id: intent.profile.id,
      version: intent.profile.version,
    };
    const coverage = await db.assetCoverage.findMany({
      where: { mediaId, current: true },
      include: { asset: true },
    });
    for (const current of coverage) {
      if (current.assetId === publishedAssetId) continue;
      const previous = StoredReleaseSchema.parse(current.asset.properties);
      const decision = chooseUpgrade({
        candidate: measured,
        current: previous,
        profile,
        mediaIds: [mediaId],
      });
      if (!decision.upgrade)
        throw new FileGuardError(
          `measured_upgrade_rejected:${decision.reason}`,
        );
    }
    if (
      coverage.length === 0 &&
      !chooseUpgrade({
        candidate: measured,
        current: null,
        profile,
        mediaIds: [mediaId],
      }).upgrade
    )
      throw new FileGuardError("measured_quality_rejected");
    profileVersions[mediaId] = profile.version;
  }
  return profileVersions;
}

export function storedMeasuredRelease(value: unknown): ReleaseAttributes {
  return StoredReleaseSchema.parse(value);
}
