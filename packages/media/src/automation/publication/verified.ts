import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type {
  NativeCompensationVerifiedPublication,
  NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import type { publicationCoverageInclude } from "#automation/reconciliation/publication-evidence.ts";
import { verifyCompensatedPlexItem } from "#automation/native-compensation/plex-proof.ts";
import type { VerifiedServingPlex } from "#shared/plex-binding/observations.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

const ExternalIdsSchema = z.record(z.string(), z.json());

export async function verifiedPublicationItems(
  context: MediaAutomationContext,
  input: {
    coverages: Prisma.AssetCoverageGetPayload<{
      include: typeof publicationCoverageInclude;
    }>[];
    items: Map<string, PlexItem[]>;
    sectionId: string;
    compensation: boolean;
    execution: NativeCompensationExecutionContext;
    binding: VerifiedServingPlex;
  },
) {
  const verified: {
    mediaId: string;
    assetId: string;
    ratingKey: string;
    externalIds: z.infer<typeof ExternalIdsSchema>;
  }[] = [];
  const compensationItems: NativeCompensationVerifiedPublication["items"] = [];
  const associations = new Map(
    input.binding.associations.map((association) => [
      association.scope.mediaId,
      association,
    ]),
  );
  if (
    new Set(input.coverages.map((coverage) => coverage.mediaId)).size !==
    input.coverages.length
  )
    throw new Error("Publication coverage repeats a canonical leaf");
  for (const coverage of input.coverages) {
    const association = associations.get(coverage.mediaId);
    if (
      association?.group.assetId !== coverage.assetId ||
      association.group.assetVersion !== coverage.asset.version ||
      association.access.sectionId !== input.sectionId
    )
      throw new PlexBindingProtection("metadata_changed");
    const item = input.items
      .get(coverage.asset.path)
      ?.find((candidate) => candidate.ratingKey === association.item.ratingKey);
    if (item === undefined) throw new PlexBindingProtection("metadata_changed");
    if (input.compensation)
      compensationItems.push(
        await verifyCompensatedPlexItem(
          context,
          {
            media: coverage.media,
            asset: coverage.asset,
            item,
            sectionId: input.sectionId,
            association,
            freshness: input.binding.freshness,
          },
          input.execution,
        ),
      );
    verified.push({
      mediaId: coverage.mediaId,
      assetId: coverage.assetId,
      ratingKey: item.ratingKey,
      externalIds: ExternalIdsSchema.parse(coverage.media.externalIds),
    });
  }
  return { verified, compensationItems };
}
