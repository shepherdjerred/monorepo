import { expect, test } from "vitest";
import { personalClaims } from "./claims.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";

function fixture(status = 5) {
  const mediaId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const record: Extract<MigrationRecord, { kind: "request" }> = {
    kind: "request",
    sourceId: "1",
    requesterSourceId: "17",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: 42 },
    scope: "movie",
    seasons: [],
    active: status === 2 || status === 5,
    sourceStatus: status,
    seasonStatuses: [],
  };
  return {
    captureId: crypto.randomUUID(),
    snapshot: captureFixture("seerr", [record]),
    targets: [
      {
        mediaId,
        kind: "movie" as const,
        externalIds: { tmdb: 42 },
        season: null,
        episode: null,
        checksum: null,
      },
    ],
    bindings: [
      {
        requesterSourceId: "17",
        id: crypto.randomUUID(),
        revision: 1,
        userId,
        valid: true,
        permittedMediaKinds: ["movie", "series"],
      },
    ],
    movieEditions: [{ mediaId, edition: "default" as const }],
    existing: [],
    historyOnly: [],
  };
}
test("Seerr Completed becomes fulfilled temporary/following consent, never viewer Done", () => {
  expect(personalClaims(fixture())[0]).toMatchObject({
    disposition: "import",
    sourceStatus: 5,
    keepingPolicy: "temporary",
    interestState: "following",
  });
});
test.each([1, 3, 4])(
  "inactive request status %i is retained as history without activation",
  (status) => {
    expect(personalClaims(fixture(status))[0]).toMatchObject({
      disposition: "history",
      mediaIds: [],
    });
  },
);
test("unknown historical status, identity drift and missing edition approval block", () => {
  const input = fixture();
  expect(personalClaims({ ...input, bindings: [] })[0]?.reason).toBe(
    "exact_plex_requester_binding_required",
  );
  expect(
    personalClaims({
      ...input,
      bindings: input.bindings.map((item) => ({ ...item, valid: false })),
    })[0]?.disposition,
  ).toBe("blocked");
  expect(personalClaims({ ...input, movieEditions: [] })[0]?.reason).toBe(
    "owner_movie_edition_selection_required",
  );
  const record = input.snapshot.records[0];
  if (record?.kind !== "request") throw new Error("Missing test request");
  delete record.sourceStatus;
  expect(personalClaims(input)[0]?.reason).toBe(
    "source_request_status_not_captured",
  );
});
test("native cancellation or Keep is preserved and explicit obsolete history is never reactivated", () => {
  const input = fixture();
  expect(
    personalClaims({
      ...input,
      existing: [
        {
          mediaId: input.targets[0]?.mediaId ?? "",
          userId: input.bindings[0]?.userId ?? "",
          edition: "default",
        },
      ],
    })[0]?.disposition,
  ).toBe("existing");
  const record = input.snapshot.records[0];
  if (record === undefined) throw new Error("Missing test request");
  expect(
    personalClaims({
      ...input,
      historyOnly: [recordKey(input.snapshot, record)],
    })[0],
  ).toMatchObject({
    disposition: "history",
    reason: "owner_reviewed_history_only",
    mediaIds: [],
  });
});
test("TV claims preserve only approved selected seasons, including explicit specials", () => {
  const input = fixture();
  const record = input.snapshot.records[0];
  if (record?.kind !== "request") throw new Error("Missing test request");
  record.scope = "season";
  record.seasons = [0, 2];
  record.seasonStatuses = [
    { season: 0, status: 5 },
    { season: 1, status: 3 },
    { season: 2, status: 2 },
  ];
  const root = {
    ...input.targets[0],
    mediaId: crypto.randomUUID(),
    kind: "series" as const,
    externalIds: { tmdb: 42 },
    season: null,
    episode: null,
    checksum: null,
  };
  const selected = [0, 1, 2].map((season) => ({
    ...root,
    mediaId: crypto.randomUUID(),
    kind: "season" as const,
    season,
    seriesExternalIds: { tmdb: 42 },
  }));
  const targets = [root, ...selected];
  const result = personalClaims({ ...input, targets })[0];
  expect(result?.mediaIds.sort()).toEqual(
    selected
      .filter((item) => item.season !== 1)
      .map((item) => item.mediaId)
      .sort(),
  );
  expect(result?.mediaIds).not.toContain(root.mediaId);
  expect(
    personalClaims({
      ...input,
      targets: targets.filter((item) => item.season !== 2),
    })[0]?.reason,
  ).toBe("selected_season_catalog_incomplete");
});
