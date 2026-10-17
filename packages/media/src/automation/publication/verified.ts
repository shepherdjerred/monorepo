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
import { matchedItem } from "./plex.ts";

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
    execution?: NativeCompensationExecutionContext | undefined;
  },
) {
  const verified: {
    mediaId: string;
    assetId: string;
    ratingKey: string;
    externalIds: z.infer<typeof ExternalIdsSchema>;
  }[] = [];
  const compensationItems: NativeCompensationVerifiedPublication["items"] = [];
  for (const coverage of input.coverages) {
    const item = await matchedItem(
      context,
      coverage.media,
      input.items.get(coverage.asset.path) ?? [],
      input.execution,
    );
    if (item === undefined) return null;
    if (input.compensation)
      compensationItems.push(
        await verifyCompensatedPlexItem(
          context,
          {
            media: coverage.media,
            asset: coverage.asset,
            item,
            sectionId: input.sectionId,
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
