import type { PlexClient } from "#integrations/plex.ts";
import {
  ServingPlexObservationSchema,
  type VerifiedServingPlex,
  type PlexVerificationProtected,
} from "#shared/plex-binding/observations.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { associationHash } from "./association/projection.ts";
import { assertAssociationActive } from "./association/io.ts";
import { servingScope } from "./association/scope.ts";
import { readSections, scanInventory } from "./association/scan.ts";
import { selectAssociations } from "./association/selection.ts";
import type {
  AssociationExecution,
  ServingVerificationInput,
} from "./association/types.ts";

/** Serving-only network proof. No native review, sessions, PG writes or ownership grant. */
export async function verifyPlexAssociations(
  context: { plex: PlexClient },
  input: ServingVerificationInput,
  execution: AssociationExecution,
): Promise<VerifiedServingPlex | PlexVerificationProtected> {
  try {
    const scope = servingScope(input);
    const freshness = plexBindingFreshness({
      observed: input.observed,
      expiresAtMs: input.expiresAtMs,
      guards: [
        execution,
        {
          assertActive: () => {
            execution.signal.throwIfAborted();
          },
        },
        ...input.guards,
      ],
    });
    const current = { ...context, execution, freshness };
    const sections = await readSections(current, scope);
    const first = await scanInventory(current, sections);
    const firstSelected = await selectAssociations(
      current,
      scope,
      first.inventory,
    );
    const second = await scanInventory(current, sections);
    const associations = await selectAssociations(
      current,
      scope,
      second.inventory,
    );
    const selectedHash = associationHash(associations);
    if (
      first.inventoryHash !== second.inventoryHash ||
      associationHash(firstSelected) !== selectedHash
    ) {
      throw new PlexBindingProtection("metadata_changed");
    }
    if (
      associationHash(await readSections(current, scope)) !==
      associationHash(sections)
    ) {
      throw new PlexBindingProtection("wrong_section");
    }
    assertAssociationActive(current);
    const observation = ServingPlexObservationSchema.parse({
      purpose: "current_serving",
      associations,
      verification: {
        startedAt: new Date(input.observed.wall).toISOString(),
        completedAt: new Date().toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
        sections,
        passes: [
          {
            itemCount: first.inventory.length,
            inventoryHash: first.inventoryHash,
            selectedHash: associationHash(firstSelected),
          },
          {
            itemCount: second.inventory.length,
            inventoryHash: second.inventoryHash,
            selectedHash,
          },
        ],
      },
    });
    assertAssociationActive(current);
    return { ...observation, freshness };
  } catch (error) {
    execution.signal.throwIfAborted();
    execution.assertActive();
    if (!(error instanceof PlexBindingProtection)) {
      throw error;
    }
    return { status: "protected", reason: error.reason };
  }
}
