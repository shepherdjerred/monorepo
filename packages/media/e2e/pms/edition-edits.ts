import assert from "node:assert/strict";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import type { PlexEditionItem } from "#integrations/plex.ts";
import type { PmsWire } from "./http.ts";
import { until } from "./http.ts";
import { allItems } from "./assertions.ts";

function retained(item: PlexEditionItem) {
  const { editionTitle: _label, ...identityAndWatch } = item;
  return identityAndWatch;
}

/** Existing synthetic item only; no renaming, replacement, rescan or authentication bypass. */
export async function assertEditionEdits(wire: PmsWire, signal: AbortSignal) {
  const sections = await wire.client.sections();
  const movieSection = sections.find((item) => item.type === "movie");
  assert.ok(movieSection);
  const inventory = await allItems(wire, movieSection.key, "movie");
  const selected = inventory.find(
    (item) => item.editionTitle == null || item.editionTitle === "",
  );
  assert.ok(selected, "Synthetic unmarked movie is missing before label edits");
  const original = await wire.client.metadataForEditionEdit(
    selected.ratingKey,
    signal,
  );
  const server = await wire.client.machineIdentifier(signal);
  const verified = [];
  // Finish by clearing a named label, proving that the unmarked choice edits the same item in place.
  const order = [
    ...MovieEditionKeySchema.options.filter((edition) => edition !== "default"),
    "default",
  ] as const;
  for (const edition of order) {
    signal.throwIfAborted();
    await wire.client.editMovieEdition(
      { sectionId: movieSection.key, ratingKey: original.ratingKey, edition },
      signal,
    );
    const after = await until(
      `PMS ${edition} label readback`,
      async () => {
        const current = await wire.client.metadataForEditionEdit(
          original.ratingKey,
          signal,
        );
        assert.deepEqual(
          retained(current),
          retained(original),
          "PMS label edit changed item identity, physical Part or watch state",
        );
        return (current.editionTitle ?? "") ===
          MOVIE_EDITION_REGISTRY[edition].plexLabel
          ? current
          : null;
      },
      signal,
    );
    assert.equal(await wire.client.machineIdentifier(signal), server);
    verified.push({
      edition,
      ratingKey: after.ratingKey,
      editionTitle: after.editionTitle ?? null,
      media: after.Media,
      viewCount: after.viewCount ?? 0,
      viewOffset: after.viewOffset ?? null,
      lastViewedAt: after.lastViewedAt ?? null,
    });
  }
  return verified;
}
