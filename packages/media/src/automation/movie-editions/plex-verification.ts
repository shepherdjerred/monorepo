import {
  MovieServingPlexV2Schema,
  type VerifiedMovieServingPlexV2,
} from "#shared/movie-editions/plex-v2.ts";
import type { PlexVerificationProtected } from "#shared/plex-binding/observations.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { associationHash } from "#automation/publication/association/projection.ts";
import { assertAssociationActive } from "#automation/publication/association/io.ts";
import { servingScope } from "#automation/publication/association/scope.ts";
import {
  readSections,
  scanInventory,
} from "#automation/publication/association/scan.ts";
import { selectMovieAssociationV2 } from "#automation/publication/association/selection.ts";
import type {
  ServingVerificationInput,
  AssociationExecution,
} from "#automation/publication/association/types.ts";
import type { PlexClient } from "#integrations/plex.ts";
import type { PlexServingExpected } from "#shared/plex-binding/library.ts";
import type { PlexMovieAssociationV2 } from "#shared/plex-binding/contract.ts";

function assertRestoredItem(
  expected: PlexServingExpected,
  association: PlexMovieAssociationV2,
) {
  if (expected.schemaVersion !== 3) return;
  const part = association.item.media[0].parts[0];
  if (
    association.item.ratingKey !== expected.originalItem.ratingKey ||
    part.id !== expected.originalItem.part.id ||
    part.file !== expected.originalItem.part.file
  )
    throw new PlexBindingProtection("metadata_changed");
}

/** Two complete stable inventories and exact metadata readbacks; no ownership or request effects. */
export async function verifyMoviePlexV2(
  context: { plex: PlexClient },
  input: ServingVerificationInput,
  execution: AssociationExecution,
): Promise<VerifiedMovieServingPlexV2 | PlexVerificationProtected> {
  try {
    const scope = servingScope(input, true);
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
    const first = await scanInventory(current, sections, true);
    const firstSelected = await selectMovieAssociationV2(
      current,
      scope,
      first.inventory,
    );
    assertRestoredItem(scope.expected, firstSelected);
    const second = await scanInventory(current, sections, true);
    const selected = await selectMovieAssociationV2(
      current,
      scope,
      second.inventory,
    );
    assertRestoredItem(scope.expected, selected);
    if (
      first.inventoryHash !== second.inventoryHash ||
      associationHash(firstSelected) !== associationHash(selected)
    )
      throw new PlexBindingProtection("metadata_changed");
    if (
      associationHash(await readSections(current, scope)) !==
      associationHash(sections)
    )
      throw new PlexBindingProtection("wrong_section");
    assertAssociationActive(current);
    const observation = MovieServingPlexV2Schema.parse({
      schemaVersion: 2,
      purpose: "current_serving",
      associations: [selected],
      verification: {
        startedAt: new Date(input.observed.wall).toISOString(),
        completedAt: new Date().toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
        sections,
        passes: [
          {
            itemCount: first.inventory.length,
            inventoryHash: first.inventoryHash,
            selectedHash: associationHash([firstSelected]),
          },
          {
            itemCount: second.inventory.length,
            inventoryHash: second.inventoryHash,
            selectedHash: associationHash([selected]),
          },
        ],
      },
    });
    assertAssociationActive(current);
    return { ...observation, freshness };
  } catch (error) {
    execution.signal.throwIfAborted();
    execution.assertActive();
    if (!(error instanceof PlexBindingProtection)) throw error;
    return { status: "protected", reason: error.reason };
  }
}
