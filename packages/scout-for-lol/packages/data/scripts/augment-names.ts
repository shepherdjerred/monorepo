import { z } from "zod";
import {
  AugmentNameCatalogSchema,
  type AugmentNameCatalog,
} from "#src/data-dragon/augment-names-schema.ts";

const ClientAugmentNamesSchema = z
  .array(
    z.object({
      id: z.number().int().positive(),
      augmentNameId: z.string().min(1).regex(/\S/),
      nameTRA: z.string().min(1).regex(/\S/),
    }),
  )
  .min(1);

/**
 * Oldest retained snapshot first, current snapshot last. A localized name may
 * change, but reusing an ID for a different augment is an explicit conflict.
 */
export function buildAugmentNameCatalog(
  snapshots: readonly { version: string; data: unknown }[],
): AugmentNameCatalog {
  const sourceVersions: string[] = [];
  const augments: AugmentNameCatalog["augments"] = {};
  for (const snapshot of snapshots) {
    if (sourceVersions.includes(snapshot.version)) {
      throw new Error(
        "Duplicate augment snapshot version: " + snapshot.version,
      );
    }
    sourceVersions.push(snapshot.version);
    const seenIds = new Set<number>();
    for (const augment of ClientAugmentNamesSchema.parse(snapshot.data)) {
      if (seenIds.has(augment.id)) {
        throw new Error("Duplicate augment ID: " + augment.id.toString());
      }
      seenIds.add(augment.id);
      const previous = augments[augment.id];
      if (
        previous !== undefined &&
        previous.apiName !== augment.augmentNameId
      ) {
        throw new Error(
          "Conflicting augment identity: " + augment.id.toString(),
        );
      }
      augments[augment.id] = {
        apiName: augment.augmentNameId,
        name: augment.nameTRA,
      };
    }
  }
  return AugmentNameCatalogSchema.parse({ sourceVersions, augments });
}
