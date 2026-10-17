import { beforeAll, afterAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaMigrationAdministration } from "./persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { MigrationSnapshotSchema } from "#shared/migration.ts";

let pg: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  pg = await startMediaTestPostgres();
});
afterAll(async () => {
  await pg.close();
});
async function fixture() {
  const actor = await pg.database.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  await pg.database.mediaRuntimeState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", recoveryEpoch: 7, mode: "observe" },
    update: {},
  });
  const snapshot = MigrationSnapshotSchema.parse({
    schemaVersion: 1,
    sourceKind: "radarr",
    sourceInstanceId: crypto.randomUUID().replaceAll("-", "").repeat(2),
    sourceVersion: "6.4.4",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    records: [],
    endpoints: ["media", "files"].map((name) => ({
      name,
      pages: 1,
      records: 0,
      digest: recordDigest([]),
      complete: true,
      stable: true,
      reason: "complete",
    })),
  });
  return {
    actor,
    snapshot,
    service: new PrismaMigrationAdministration(pg.database),
  };
}
test("repeated upload is immutable and review records no ownership or runtime changes", async () => {
  const { actor, snapshot, service } = await fixture();
  const before = await pg.database.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const first = await service.upload(actor, { snapshot });
  expect(await service.upload(actor, { snapshot })).toEqual(first);
  const input = {
    expectedVersion: first.version,
    reportHash: first.reportHash,
    captureHash: first.captureHash,
    recoveryEpoch: first.recoveryEpoch,
    runtimeVersion: first.runtimeVersion,
    action: "approve" as const,
    acknowledgeNoOwnershipTransfer: true as const,
  };
  const key = crypto.randomUUID();
  expect(await service.review(actor, key, first.id, input)).toMatchObject({
    status: "completed",
    version: 1,
  });
  expect(await service.review(actor, key, first.id, input)).toMatchObject({
    version: 1,
  });
  expect(
    await pg.database.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(before);
  const reviewed = await service.list(actor);
  expect(reviewed.find((row) => row.id === first.id)?.status).toBe("approved");
  await expect(
    pg.database.migrationCapture.update({
      where: { id: first.captureId },
      data: { stable: false },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    pg.database.adoptionProposal.update({
      where: { id: first.id },
      data: { reportHash: "b".repeat(64) },
    }),
  ).rejects.toThrow("immutable");
});
test("owner-only review rejects incomplete captures and stale runtime epochs", async () => {
  const { actor, snapshot, service } = await fixture();
  await expect(service.list({ ...actor, role: "member" })).rejects.toThrow();
  const incomplete = {
    ...snapshot,
    endpoints: snapshot.endpoints.map((endpoint) => ({
      ...endpoint,
      complete: false,
      stable: false,
      reason: "read_failed" as const,
    })),
  };
  const protectedProposal = await service.upload(actor, {
    snapshot: incomplete,
  });
  await expect(
    service.review(actor, crypto.randomUUID(), protectedProposal.id, {
      expectedVersion: 0,
      reportHash: protectedProposal.reportHash,
      captureHash: protectedProposal.captureHash,
      recoveryEpoch: protectedProposal.recoveryEpoch,
      runtimeVersion: protectedProposal.runtimeVersion,
      action: "approve",
      acknowledgeNoOwnershipTransfer: true,
    }),
  ).rejects.toThrow("Incomplete");
  const ready = await service.upload(actor, { snapshot });
  await pg.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: { increment: 1 }, version: { increment: 1 } },
  });
  await expect(
    service.review(actor, crypto.randomUUID(), ready.id, {
      expectedVersion: 0,
      reportHash: ready.reportHash,
      captureHash: ready.captureHash,
      recoveryEpoch: ready.recoveryEpoch,
      runtimeVersion: ready.runtimeVersion,
      action: "approve",
      acknowledgeNoOwnershipTransfer: true,
    }),
  ).rejects.toThrow("runtime changed");
});
test("catalog null IDs remain absent, canonical TMDB IDs resolve, and contradictions fail", async () => {
  const { actor, snapshot, service } = await fixture();
  const movie = await pg.database.mediaItem.create({
    data: {
      kind: "movie",
      title: "Catalog fixture",
      tmdbId: 191_919,
      externalIds: { imdb: null },
    },
  });
  const record = {
    kind: "media" as const,
    sourceId: "42",
    mediaKind: "movie" as const,
    externalIds: { tmdb: 191_919 },
    parentSourceId: null,
    season: null,
    episode: null,
    profileSourceId: null,
    monitored: true,
  };
  const capture = {
    ...snapshot,
    records: [record],
    endpoints: snapshot.endpoints.map((endpoint) =>
      endpoint.name === "media"
        ? { ...endpoint, records: 1, digest: recordDigest([record]) }
        : endpoint,
    ),
  };
  const result = await service.upload(actor, { snapshot: capture });
  expect(result.report.entries[0]).toMatchObject({
    confidence: "exact",
    mediaIds: [movie.id],
  });
  await pg.database.mediaItem.update({
    where: { id: movie.id },
    data: { externalIds: { tmdb: 191_920, imdb: null } },
  });
  await expect(service.upload(actor, { snapshot: capture })).rejects.toThrow(
    "Catalog TMDB identities disagree",
  );
  await pg.database.mediaItem.update({
    where: { id: movie.id },
    data: { externalIds: { tmdb: 191_919, imdb: null } },
  });
});
