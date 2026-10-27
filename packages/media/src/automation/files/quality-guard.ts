import { chooseUpgrade, evaluateRelease } from "#domain/quality.ts";
import {
  PublicReleaseAttributesSchema,
  QualityRulesSchema,
} from "#shared/api.ts";
import type { ReleaseAttributes } from "#shared/contract.ts";
import { FileGuardError, type Transaction } from "./types.ts";
import { z } from "zod";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { currentMeasuredQuality } from "#automation/acquisition-management/current-quality.ts";

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
      where: targetWhere(defaultScope(mediaId)),
      include: { profile: true },
    });
    if (intent.profile === null) throw new FileGuardError("profile_missing");
    const profile = {
      ...QualityRulesSchema.parse(intent.profile.rules),
      id: intent.profile.id,
      version: intent.profile.version,
    };
    if (!evaluateRelease(measured, profile, [mediaId]).accepted)
      throw new FileGuardError("measured_quality_rejected");
    const coverage = await db.assetCoverage.findMany({
      where: { mediaId, edition: "default", current: true },
      include: {
        asset: {
          include: {
            coverage: {
              where: { current: true },
              include: {
                media: { include: { parent: { include: { parent: true } } } },
              },
            },
          },
        },
      },
    });
    for (const current of coverage) {
      if (current.assetId === publishedAssetId) continue;
      const previous = currentMeasuredQuality(
        StoredReleaseSchema.parse(current.asset.properties),
        current.asset.coverage.map((item) => item.media),
      );
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
    profileVersions[mediaId] = profile.version;
  }
  return profileVersions;
}

export function storedMeasuredRelease(value: unknown): ReleaseAttributes {
  return StoredReleaseSchema.parse(value);
}
