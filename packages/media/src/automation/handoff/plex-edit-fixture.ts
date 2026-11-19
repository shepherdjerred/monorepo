import { PrepareLibraryHandoffV3Schema } from "#shared/handoff/library-v3.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import type { PlexClient, PlexEditionItem } from "#integrations/plex.ts";
import type { Database } from "#infrastructure/database.ts";
import { handoffFixture } from "./test-fixture.ts";

/** Actual capture, review, scope and queued command; only Plex transport is synthetic. */
export async function libraryPlexFixture(
  db: Database,
  edition: MovieEditionKey,
  options: {
    classify?: "from_filename" | "owner_review";
    fileName?: string;
  } = {},
) {
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const f = await handoffFixture(db, {
    fileName:
      options.fileName ??
      `Synthetic Film${edition === "default" ? "" : ` {edition-${label}}`}.mkv`,
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
        movies:
          options.classify === "from_filename"
            ? []
            : files.map((file) => ({
                provenanceKey: file.provenanceKey,
                edition,
                resolution:
                  options.classify === "owner_review"
                    ? {
                        kind: "owner_review",
                        reason: "Owner confirmed the synthetic fixture cut",
                      }
                    : { kind: "conventional" },
              })),
      });
    },
  });
  const original = await f.network.context.plex.metadata("fixture");
  const item: PlexEditionItem = {
    ...original,
    ratingKey: "123",
    type: "movie",
    editionTitle: "Incorrect label",
    viewCount: 3,
    lastViewedAt: 1_234_567,
    viewOffset: 456_000,
  };
  const library = singleLibraryPlexMovie(f.network.context.plex, item);
  const context = Object.assign(f.network.context, { plex: library.client });
  return { ...f, network: { ...f.network, context }, ...library };
}

/** One mutable synthetic Plex item is observed consistently by all three actual APIs. */
export function singleLibraryPlexMovie<
  T extends Pick<PlexClient, "libraryPage" | "metadata">,
>(plex: T, initial: PlexEditionItem) {
  let item = initial;
  const reads: Pick<
    PlexClient,
    "libraryPage" | "metadata" | "metadataForEditionEdit"
  > = {
    libraryPage: () => Promise.resolve({ total: 1, items: [item] }),
    metadata: () => Promise.resolve(item),
    metadataForEditionEdit: () => Promise.resolve(item),
  };
  const client = Object.assign(plex, reads);
  return {
    client,
    setItem(value: PlexEditionItem) {
      item = value;
    },
    item: () => item,
  };
}
