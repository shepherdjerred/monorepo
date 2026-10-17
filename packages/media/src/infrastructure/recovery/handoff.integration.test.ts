import { beforeAll, afterAll, test, expect } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { applyPreparedHandoff } from "#automation/handoff/apply.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PrismaRecovery } from "./service.ts";
import { releaseInput } from "./test-support.ts";
import { unresolvedRecoveryClaims } from "./provenance.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("an omitted active migration claim affecting the adopted title remains an explicit household blocker", async () => {
  const db = cluster.database;
  const f = await handoffFixture(db, {
    extendReport: async ({ report }) => {
      const entry = report.entries.find(
        (item) => item.sourceRecord.kind === "request",
      );
      if (entry?.sourceRecord.kind !== "request")
        throw new Error("Missing fixture request");
      const record = {
        ...entry.sourceRecord,
        sourceId: "unmapped-request",
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
      };
      report.entries.push({
        ...entry,
        sourceId: record.sourceId,
        sourceRecord: record,
        provenanceKey: snapshotHash(record.sourceId),
        observationHash: snapshotHash(z.json().parse(record)),
        mediaIds: [],
      });
    },
  });
  directories.push(f.directory);
  const ready = await f.ready();
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const service = new PrismaRecovery(db, "server");
  const result = await service.prepare(f.network.actor, crypto.randomUUID(), {
    mediaIds: [f.network.media.id],
  });
  const review = await service.detail(
    f.network.actor,
    z.uuid().parse(result.recoveryReviewId),
  );
  expect(review.scope.blockers).toContain(
    "unresolved_migration_household_claim",
  );
  await expect(
    service.release(
      f.network.actor,
      crypto.randomUUID(),
      review.id,
      releaseInput(review),
    ),
  ).rejects.toThrow("resolve all scope and household blockers");
  expect(
    await db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.network.media.id },
    }),
  ).toMatchObject({ releasedAt: null });
});

test("real movie handoff release ignores unrelated TV TMDB collisions while TV ancestry and legacy sources stay protected", async () => {
  const db = cluster.database;
  const f = await handoffFixture(db, {
    extendReport: async ({ report }) => {
      const media = report.entries[0];
      if (!media) throw new Error("Missing fixture media");
      const request = report.entries.find(
        (entry) => entry.sourceRecord.kind === "request",
      );
      if (request?.sourceRecord.kind !== "request")
        throw new Error("Missing fixture request");
      const tvRequest = {
        ...request.sourceRecord,
        sourceId: "unrelated-tv-request",
        scope: "series" as const,
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
      };
      report.entries.push({
        ...request,
        sourceRecord: tvRequest,
        sourceId: tvRequest.sourceId,
        provenanceKey: snapshotHash(tvRequest.sourceId),
        observationHash: snapshotHash(z.json().parse(tvRequest)),
        mediaIds: [],
      });
      const record = {
        kind: "torrent" as const,
        sourceId: "legacy-torrent",
        infoHash: "a".repeat(40),
        wireId: "a".repeat(40),
        infoHashV1: "a".repeat(40),
        infoHashV2: null,
        category: "radarr",
        tags: [],
        savePath: "/legacy/downloads",
        progress: 1,
        ratioLimit: -1,
        seedingTimeLimitMinutes: -1,
        inactiveSeedingTimeLimitMinutes: -1,
        effectiveRatioLimit: -1,
        effectiveSeedingTimeLimitMinutes: -1,
        effectiveInactiveSeedingTimeLimitMinutes: -1,
        ratio: { kind: "finite" as const, value: 2 },
        seededSeconds: 100,
        shareLimitAction: "Stop" as const,
        automaticManagement: false,
        forceStarted: false,
        managerAssociations: [],
      };
      report.entries.push({
        ...media,
        sourceRecord: record,
        kind: "torrent",
        sourceId: record.sourceId,
        provenanceKey: snapshotHash(record.sourceId),
        observationHash: snapshotHash(record),
        reasons: ["protected_legacy_source"],
      });
    },
  });
  directories.push(f.directory);
  const ready = await f.ready();
  const handoffReceipt = await applyPreparedHandoff(
    f.context,
    ready.input,
    ready.prepared,
  );
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Unrelated series with colliding TMDB ID",
      tmdbId: f.network.media.tmdbId,
    },
  });
  const season = await db.mediaItem.create({
    data: { kind: "season", title: "Season one", parentId: series.id },
  });
  const episode = await db.mediaItem.create({
    data: { kind: "episode", title: "Episode one", parentId: season.id },
  });
  const appliedReceipt = await db.mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: handoffReceipt },
  });
  expect(
    await unresolvedRecoveryClaims(db, {
      planIds: [appliedReceipt.planId],
      mediaIds: [episode.id],
    }),
  ).toBe(true);
  const users = await db.mediaUser.findMany();
  for (const user of users) {
    const permission = {
      kind: "account",
      serverMachineId: "server",
      verifiedAt: new Date(),
      permittedSectionIds: ["1", "2"],
      permittedMediaKinds: ["movie", "series"],
    };
    await db.plexIdentityMapping.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...permission },
      update: permission,
    });
  }
  const recovery = new PrismaRecovery(db, "server");
  const prepared = await recovery.prepare(
    f.network.actor,
    crypto.randomUUID(),
    { mediaIds: [f.network.media.id] },
  );
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const review = await recovery.detail(f.network.actor, id);
  expect(review.scope.handoffReceipts.map((receipt) => receipt.id)).toContain(
    handoffReceipt,
  );
  expect(review.scope.blockers).toEqual([]);
  for (const user of users)
    await recovery.respond(user, crypto.randomUUID(), id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId: f.network.media.id, intent: "request" }],
    });
  const complete = await recovery.detail(f.network.actor, id);
  await recovery.release(
    f.network.actor,
    crypto.randomUUID(),
    id,
    releaseInput(complete),
  );
  expect(
    await db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.network.media.id },
    }),
  ).toMatchObject({ releasedById: f.network.actor.id });
  expect(
    await db.torrent.findUniqueOrThrow({ where: { infoHash: "a".repeat(40) } }),
  ).toMatchObject({
    owned: false,
    ownershipEpoch: -1,
    state: "migration_protected",
  });
});
