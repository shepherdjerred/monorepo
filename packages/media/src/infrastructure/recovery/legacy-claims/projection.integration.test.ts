import { expect, test } from "vitest";
import { snapshotHash } from "#migration/profile-import.ts";
import { legacyClaimsHarness } from "./test-fixture.ts";
const harness = legacyClaimsHarness();

test("identical movie and series TMDB numbers never cross the legacy request namespace", async () => {
  const f = await harness.setup();
  await f.db.mediaItem.update({
    where: { id: f.series.id },
    data: { tmdbId: f.movie.tmdbId },
  });
  const source = await f.capture();
  await f.bind(source.captureId);
  const episode = await f.project([f.first.id]);
  expect(episode.claims).toEqual([]);
  expect(episode.blockers).toEqual([]);
  expect(episode.relevantClaims).toEqual([]);
  const movie = await f.project([f.movie.id]);
  expect(movie.claims).toHaveLength(1);
});

test("exact movie mapping is immutable identity evidence and creates no household demand", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  const unmapped = await f.project([f.movie.id]);
  expect(unmapped.blockers).toContain("legacy_claim_requester_unmapped");
  const before = await f.db.migrationCapture.findUniqueOrThrow({
    where: { id: source.captureId },
  });
  await f.bind(source.captureId);
  const projection = await f.project([f.movie.id]);
  expect(projection.blockers).toEqual([]);
  expect(projection.claims).toMatchObject([
    {
      userId: f.subject.id,
      mediaIds: [f.movie.id],
      outsideMediaIds: [],
      sourceScope: "movie",
    },
  ]);
  expect(
    await f.db.mediaRequest.count({ where: { userId: f.subject.id } }),
  ).toBe(0);
  expect(await f.db.mediaIntent.count({ where: { mediaId: f.movie.id } })).toBe(
    0,
  );
  expect(
    await f.db.migrationCapture.findUniqueOrThrow({
      where: { id: source.captureId },
    }),
  ).toEqual(before);
  const binding = await f.db.legacyRequesterBinding.findFirstOrThrow({
    where: { captureId: source.captureId },
  });
  await expect(
    f.db.legacyRequesterBinding.update({
      where: { id: binding.id },
      data: { userId: f.owner.id },
    }),
  ).rejects.toThrow();
});

test("season accounting releases only declared exact leaves, never outside remainder or a later capture", async () => {
  const f = await harness.setup();
  const source = await f.capture({ scope: "season" });
  await f.bind(source.captureId);
  const first = await f.project([f.first.id]);
  expect(first.claims).toMatchObject([
    { mediaIds: [f.first.id], outsideMediaIds: [f.second.id], seasons: [1] },
  ]);
  await f.account(first.claims);
  const accounted = await f.project([f.first.id]);
  const outside = await f.project([f.second.id]);
  expect(accounted.claims).toEqual([]);
  expect(outside.claims).toMatchObject([{ mediaIds: [f.second.id] }]);
  const later = await f.capture({ scope: "season" });
  const unmapped = await f.project([f.first.id]);
  expect(unmapped.blockers).toContain("legacy_claim_requester_unmapped");
  await f.bind(later.captureId);
  const current = await f.project([f.first.id]);
  expect(current.claims).toHaveLength(1);
  expect(current.claims[0]?.captureId).toBe(later.captureId);
  expect(
    await f.db.mediaRequest.count({ where: { userId: f.subject.id } }),
  ).toBe(0);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  const restored = await f.project([f.first.id]);
  expect(restored.claims).toHaveLength(2);
});

test("same numeric requester in separate instances never shares an identity association", async () => {
  const f = await harness.setup();
  const first = await f.capture();
  const second = await f.capture({
    sourceInstanceId: snapshotHash("different-fixture-instance"),
  });
  await f.bind(first.captureId);
  const pending = await f.project([f.movie.id]);
  expect(pending.claims).toHaveLength(1);
  expect(pending.blockers).toContain("legacy_claim_requester_unmapped");
  await f.bind(second.captureId);
  const mapped = await f.project([f.movie.id]);
  expect(mapped.claims).toHaveLength(2);
  expect(
    new Set(mapped.claims.map((claim) => claim.sourceInstanceId)).size,
  ).toBe(2);
});

test("normal verification refresh preserves association but exact account reassignment protects it", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  await f.bind(source.captureId);
  await f.db.plexIdentityMapping.update({
    where: { userId: f.subject.id },
    data: {
      version: { increment: 1 },
      verifiedAt: new Date(),
      permittedSectionIds: ["1"],
    },
  });
  const refreshed = await f.project([f.movie.id]);
  expect(refreshed.claims).toHaveLength(1);
  await f.db.plexIdentityMapping.update({
    where: { userId: f.subject.id },
    data: { serverAccountId: "changed-local-person" },
  });
  const reassigned = await f.project([f.movie.id]);
  expect(reassigned.blockers).toContain(
    "legacy_claim_binding_identity_changed",
  );
});

test.each(["episode", "missing_season", "pending_catalog"] as const)(
  "%s remains a protected source claim",
  async (condition) => {
    const f = await harness.setup();
    const source = await f.capture({
      scope: condition === "episode" ? "episode" : "season",
      seasons: condition === "missing_season" ? [3] : [1],
    });
    await f.bind(source.captureId);
    if (condition === "pending_catalog")
      await f.db.mediaItem.update({
        where: { id: f.series.id },
        data: { catalogState: "pending" },
      });
    const result = await f.project([f.first.id]);
    expect(result.claims).toEqual([]);
    expect(result.blockers).toContain(
      condition === "episode"
        ? "legacy_claim_episode_coordinates_missing"
        : "legacy_claim_catalog_incomplete",
    );
  },
);
