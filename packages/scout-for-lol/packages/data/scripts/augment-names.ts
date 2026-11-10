import { z } from "zod";
import {
  AugmentNameCatalogSchema,
  type AugmentNameCatalog,
} from "#src/data-dragon/augment-names-schema.ts";

// CommunityDragon's client catalog carries these placeholder IDs with a blank
// display name. Since 16.21, 3176 (GoH_PentakillAug_Generic) has nameTRA "   "
// while its siblings 3170-3173 carry real names, and the detailed Arena catalog
// omits it. A pinned ID with a blank name is left out of the catalog; any other
// blank name still fails the refresh.
const UNNAMED_CLIENT_AUGMENT_IDS: ReadonlySet<number> = new Set([3176]);

const HAS_VISIBLE_TEXT = /\S/;

const ClientAugmentNamesSchema = z
  .array(
    z
      .object({
        id: z.number().int().positive(),
        augmentNameId: z.string().min(1).regex(HAS_VISIBLE_TEXT),
        nameTRA: z.string(),
      })
      .refine(
        (augment) =>
          HAS_VISIBLE_TEXT.test(augment.nameTRA) ||
          UNNAMED_CLIENT_AUGMENT_IDS.has(augment.id),
        {
          message:
            "Blank augment name for an ID not in UNNAMED_CLIENT_AUGMENT_IDS",
          path: ["nameTRA"],
        },
      ),
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
    const parsed = ClientAugmentNamesSchema.safeParse(snapshot.data);
    if (!parsed.success) {
      throw new Error(
        "Invalid CommunityDragon augment names for " +
          snapshot.version +
          ": " +
          z.prettifyError(parsed.error),
        { cause: parsed.error },
      );
    }
    const seenIds = new Set<number>();
    for (const augment of parsed.data) {
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
      if (!HAS_VISIBLE_TEXT.test(augment.nameTRA)) {
        continue;
      }
      augments[augment.id] = {
        apiName: augment.augmentNameId,
        name: augment.nameTRA,
      };
    }
  }
  return AugmentNameCatalogSchema.parse({ sourceVersions, augments });
}
