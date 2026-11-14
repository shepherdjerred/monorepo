import type { PlexAssociation } from "#shared/plex-binding/contract.ts";
import type { AssociationContext } from "#automation/publication/association/types.ts";
import {
  plexRead,
  assertAssociationActive,
} from "#automation/publication/association/io.ts";
import {
  projectAssociatedItem,
  associationHash,
} from "#automation/publication/association/projection.ts";
import { readHierarchy } from "#automation/publication/association/hierarchy.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  NativeWatchValueSchema,
  type NativeWatchValue,
} from "#shared/plex-binding/completion.ts";

/** The boolean belongs to this exact metadata response, never a second key lookup. */
export async function observeAssociatedWatch(
  context: AssociationContext,
  association: PlexAssociation,
): Promise<boolean | null> {
  const observed = await observeAssociatedWatchValue(context, association);
  return observed?.watched ?? null;
}

/** Preserve the optional counter from the exact same identity-checked response. */
export async function observeAssociatedWatchValue(
  context: AssociationContext,
  association: PlexAssociation,
): Promise<NativeWatchValue | null> {
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
    if (
      associationHash(projectAssociatedItem(observed.item, association)) !==
      associationHash(association.item)
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
    return NativeWatchValueSchema.parse({
      watched: observed.watched,
      viewCount: observed.item.viewCount ?? null,
    });
  } catch (error) {
    // Expiry/cancellation must escape; only a parsed external mismatch becomes unknown.
    assertAssociationActive(context);
    if (error instanceof PlexBindingProtection) return null;
    throw error;
  }
}
