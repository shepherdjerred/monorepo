import { PrepareLibraryHandoffV3Schema } from "#shared/handoff/library-v3.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import type { PlexEditionItem } from "#integrations/plex.ts";
import type { Database } from "#infrastructure/database.ts";
import { handoffFixture } from "./test-fixture.ts";

/** Actual capture, review, scope and queued command; only Plex transport is synthetic. */
export async function libraryPlexFixture(
  db: Database,
  edition: MovieEditionKey,
) {
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const f = await handoffFixture(db, {
    fileName: `Synthetic Film${edition === "default" ? "" : ` {edition-${label}}`}.mkv`,
    prepareRequest({ request, report }) {
      const files = report.entries.filter((entry) => entry.kind === "file");
      return PrepareLibraryHandoffV3Schema.parse({
        ...request,
        schemaVersion: 3,
        purpose: "migration",
        plexEditionLabels: "update_in_place",
        selected: files.map((file) => ({
          provenanceKey: file.provenanceKey,
          evidenceHash: file.observationHash,
        })),
        movies: files.map((file) => ({
          provenanceKey: file.provenanceKey,
          edition,
          resolution: { kind: "conventional" },
        })),
      });
    },
  });
  const original = await f.network.context.plex.metadata("fixture");
  let item: PlexEditionItem = {
    ...original,
    ratingKey: "123",
    type: "movie",
    editionTitle: "Incorrect label",
    viewCount: 3,
    lastViewedAt: 1_234_567,
    viewOffset: 456_000,
  };
  f.network.context.plex.libraryPage = () =>
    Promise.resolve({ total: 1, items: [item] });
  f.network.context.plex.metadata = () => Promise.resolve(item);
  f.network.context.plex.metadataForEditionEdit = () => Promise.resolve(item);
  return {
    ...f,
    setItem(value: PlexEditionItem) {
      item = value;
    },
    item: () => item,
  };
}
