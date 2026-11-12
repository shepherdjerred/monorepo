import { expect, test } from "vitest";
import type { PlexInventoryObservation } from "#generated/prisma/client.ts";
import { ExternalLibraryRegistrationSchema } from "#shared/external-library/contract.ts";
import {
  externalInventoryMatches,
  EXTERNAL_INVENTORY_FRESHNESS_MS,
} from "./availability.ts";

function fixture() {
  const now = new Date("2026-11-12T06:00:00.000Z");
  const registration = ExternalLibraryRegistrationSchema.parse({
    schemaVersion: 1,
    source: "plex",
    registrationEventId: crypto.randomUUID(),
    registeredAt: "2026-11-11T06:00:00.000Z",
    serverMachineId: "external-server",
    sectionId: "1",
    sectionType: "movie",
    rootMediaId: crypto.randomUUID(),
    rootTmdbId: 123,
    rootYear: 2020,
    rootCatalogIdentityHash: "a".repeat(64),
    edition: "default",
    observedEditionTitle: null,
    canonicalEdition: null,
    editionConfidence: "unknown",
    members: [
      {
        mediaId: crypto.randomUUID(),
        ratingKey: "5",
        partId: "7",
        guids: ["tmdb://123"],
        seasonNumber: null,
        episodeNumber: null,
      },
    ],
    canonicalPath: "/data/movies/Existing/movie.mkv",
    sizeBytes: "1000",
  });
  const observation: PlexInventoryObservation = {
    sectionId: "1",
    ratingKey: "5",
    path: registration.canonicalPath,
    kind: "movie",
    guids: [{ id: "tmdb://123" }],
    seasonNumber: null,
    episodeNumber: null,
    scanId: "inventory-scan",
    observedAt: new Date(now.getTime() - 60_000),
  };
  const scan = {
    id: observation.scanId,
    kind: "inventory",
    state: "running",
    progress: { section: 2, offset: 0 },
    startedAt: new Date(now.getTime() - 120_000),
    completedAt: null,
  };
  return { registration, observation, scan, now };
}

test("a complete Plex collection is usable without pretending owned cleanup/archive has finished or proving an unknown movie cut", () => {
  const f = fixture();
  expect(
    externalInventoryMatches(f.registration, [f.observation], [f.scan], f.now),
  ).toBe(true);
  expect(f.scan).toMatchObject({ state: "running", completedAt: null });
  expect(f.registration).toMatchObject({
    canonicalEdition: null,
    editionConfidence: "unknown",
  });
  f.scan.state = "failed";
  expect(
    externalInventoryMatches(f.registration, [f.observation], [f.scan], f.now),
  ).toBe(true);
});

test("a new Plex item sharing the physical file invalidates incomplete registered coverage", () => {
  const f = fixture();
  expect(
    externalInventoryMatches(
      f.registration,
      [f.observation, { ...f.observation, ratingKey: "99" }],
      [f.scan],
      f.now,
    ),
  ).toBe(false);
});

test.each([
  "missing",
  "changed_path",
  "changed_guid",
  "changed_section",
  "changed_rating_key",
  "changed_coordinates",
  "future",
  "stale",
  "before_scan",
  "incomplete",
  "wrong_scan",
  "wrong_kind",
])("%s inventory never becomes external availability", (change) => {
  const f = fixture();
  if (change === "missing") {
    expect(externalInventoryMatches(f.registration, [], [f.scan], f.now)).toBe(
      false,
    );
    return;
  }
  switch (change) {
    case "changed_path":
      f.observation.path += ".replaced";
      break;
    case "changed_guid":
      f.observation.guids = [{ id: "tmdb://999" }];
      break;
    case "changed_section":
      f.observation.sectionId = "2";
      break;
    case "changed_rating_key":
      f.observation.ratingKey = "6";
      break;
    case "changed_coordinates":
      f.observation.episodeNumber = 1;
      break;
    case "future":
      f.observation.observedAt = new Date(f.now.getTime() + 1);
      break;
    case "stale":
      f.observation.observedAt = new Date(
        f.now.getTime() - EXTERNAL_INVENTORY_FRESHNESS_MS - 1,
      );
      f.scan.startedAt = new Date(f.observation.observedAt.getTime() - 1);
      break;
    case "before_scan":
      f.observation.observedAt = new Date(f.scan.startedAt.getTime() - 1);
      break;
    case "incomplete":
      f.scan.progress.section = 1;
      break;
    case "wrong_scan":
      f.scan.id = "different-scan";
      break;
    case "wrong_kind":
      f.observation.kind = "episode";
      break;
  }
  expect(
    externalInventoryMatches(f.registration, [f.observation], [f.scan], f.now),
  ).toBe(false);
});
