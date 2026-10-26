import type { PlexAssociationV1 } from "#shared/plex-binding/contract.ts";
import type { AssociationContext } from "#automation/publication/association/types.ts";
import {
  plexRead,
  assertAssociationActive,
} from "#automation/publication/association/io.ts";
import {
  projectItem,
  associationHash,
} from "#automation/publication/association/projection.ts";
import { readHierarchy } from "#automation/publication/association/hierarchy.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** The boolean belongs to this exact metadata response, never a second key lookup. */
export async function observeAssociatedWatch(
  context: AssociationContext,
  association: PlexAssociationV1,
): Promise<boolean | null> {
  try {
    const observed = await plexRead(
      context,
      () =>
        context.plex.observeWatch(
          association.item.ratingKey,
          context.execution.signal,
        ),
      "metadata_changed",
    );
    const item = projectItem(observed.item);
    if (
      associationHash({
        ratingKey: item.ratingKey,
        type: item.type,
        guids: item.guids,
        media: item.media,
      }) !== associationHash(association.item)
    )
      return null;
    if (association.kind === "episode") {
      const hierarchy = await readHierarchy(
        context,
        observed.item,
        new Map([[observed.item.ratingKey, observed.item]]),
      );
      if (associationHash(hierarchy) !== associationHash(association.hierarchy))
        return null;
    }
    assertAssociationActive(context);
    return observed.watched;
  } catch (error) {
    // Expiry/cancellation must escape; only a parsed external mismatch becomes unknown.
    assertAssociationActive(context);
    if (error instanceof PlexBindingProtection) return null;
    throw error;
  }
}
