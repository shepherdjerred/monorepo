import { expect, test } from "vitest";
import { z } from "zod";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { visibilityFixture } from "./test-fixture.ts";
import { recordCleanupEvaluation } from "./seeding.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { withTvVisibility } from "./tv.test-support.ts";

const h = automationTestHarness();

test("current direct and root-covered co-requesters see shared progress; exclusion and root cancellation remove it", async () => {
  await withTvVisibility(h.database(), false, async (f) => {
    const joined = await f.db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Second requester",
      },
    });
    await grantTestRequesterAccess(f.db, joined.id, "fixture-server");
    const request = await f.db.mediaRequest.create({
      data: { userId: joined.id, mediaId: f.media.id },
    });
    const direct = await f.app.getMedia(joined, f.media.id);
    expect(direct.visibility.attempts.map((row) => row.id)).toEqual([
      f.attempt.id,
    ]);
    expect(direct.visibility.torrents.map((row) => row.id)).toEqual([
      f.torrent.id,
    ]);
    expect(JSON.stringify(direct.visibility)).not.toContain(f.member.id);
    expect(JSON.stringify(direct.visibility)).not.toContain(f.request.id);
    const root = await f.cover(joined);
    // Model the inherited TV leaf after testing its independent direct claim.
    await f.db.mediaRequest.update({
      where: { id: request.id },
      data: { direct: false },
    });
    const covered = await f.app.getMedia(joined, f.media.id);
    expect(covered.visibility.attempts).toHaveLength(1);
    const current = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    await f.app.cancelRequest(
      joined,
      crypto.randomUUID(),
      current.id,
      current.version,
    );
    const excluded = await f.app.getMedia(joined, f.media.id);
    expect(excluded.visibility.attempts).toEqual([]);
    expect(excluded.visibility.torrents).toEqual([]);
    await f.app.createRequest(joined, crypto.randomUUID(), {
      mediaId: f.media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    });
    const renewedRoot = await f.cover(joined);
    await f.db.mediaRequest.update({
      where: { id: request.id },
      data: { direct: false },
    });
    expect(renewedRoot.id).toBe(root.id);
    const renewed = await f.app.getMedia(joined, f.media.id);
    expect(renewed.visibility.attempts).toHaveLength(1);
    await f.app.cancelRequest(
      joined,
      crypto.randomUUID(),
      renewedRoot.id,
      renewedRoot.version,
    );
    const cancelled = await f.app.getMedia(joined, f.media.id);
    expect(cancelled.visibility.attempts).toEqual([]);
    expect(cancelled.visibility.torrents).toEqual([]);
  });
});

test("persisted progress precedes assets; legacy playback labels and cancelled seeding remain separate", async () => {
  const f = await visibilityFixture(h.database());
  const downloading = await f.app.getMedia(f.member, f.media.id);
  expect(downloading.visibility).toMatchObject({
    playback: { playable: false, upgradeInProgress: false },
    attempts: [{ id: f.attempt.id }],
    torrents: [{ progress: 0.4, freshness: "fresh", diagnostics: null }],
  });
  await f.publish();
  const upgraded = await f.app.getMedia(f.owner, f.media.id);
  expect(upgraded.visibility.playback).toMatchObject({
    playable: false,
    currentAssetId: null,
    currentVersion: null,
    upgradeInProgress: false,
    association: { legacyUnverifiedItems: 1, reconciliationRequiredItems: 0 },
  });
  await f.db.acquisitionAttempt.update({
    where: { id: f.attempt.id },
    data: { state: "cancelled" },
  });
  const currentRequest = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: f.request.id },
  });
  await f.app.cancelRequest(
    f.member,
    crypto.randomUUID(),
    currentRequest.id,
    currentRequest.version,
  );
  const torrent = await f.db.torrent.update({
    where: { id: f.torrent.id },
    data: {
      state: "seeding",
      observation: {
        ...f.observation,
        torrent: {
          ...f.observation.torrent,
          progress: 1,
          ratio: { kind: "infinite" },
          seeding_time: 100,
        },
      },
      observedAt: new Date(),
    },
  });
  await recordCleanupEvaluation(f.db, torrent, {
    phase: "evaluation",
    status: "protected",
    reason: "source_cleanup_disabled",
    recoveryEpoch: f.runtime.recoveryEpoch,
    evaluatedAt: new Date(),
  });
  const detail = await f.app.getMedia(f.owner, f.media.id);
  expect(detail.visibility).toMatchObject({
    playback: {
      playable: false,
      upgradeInProgress: false,
      association: { legacyUnverifiedItems: 1, reconciliationRequiredItems: 0 },
    },
    torrents: [
      {
        ratio: { kind: "infinite" },
        seededSeconds: 100,
        diagnostics: {
          obligation: {
            satisfied: true,
            reason: "obligations_satisfied",
            requiredSeconds: 604_800,
          },
          cleanup: {
            status: "protected",
            reason: "source_cleanup_disabled",
            freshness: "current",
          },
        },
      },
    ],
  });
  expect(JSON.stringify(detail)).not.toMatch(/PRIVATE|SECRET|aaaaaa/u);
  expect(JSON.stringify(detail.visibility)).not.toMatch(/bbbbbb/u);
});

test("current role and exact section govern all detail diagnostics and household privacy without blocking restricted reads", async () => {
  const f = await visibilityFixture(h.database());
  await f.publish();
  await f.db.mediaRequest.create({
    data: { mediaId: f.media.id, userId: f.owner.id },
  });
  await f.db.retentionHold.create({
    data: { mediaId: f.media.id, userId: f.owner.id, isPin: true },
  });
  await f.db.watchState.create({
    data: {
      mediaId: f.media.id,
      userId: f.owner.id,
      watched: true,
      source: "plex",
      observedAt: new Date(),
    },
  });
  const member = await f.app.getMedia(f.member, f.media.id);
  expect(member.requests.map((row) => row.userId)).toEqual([f.member.id]);
  expect(member.holds).toEqual([]);
  expect(member.watchStates).toEqual([]);
  expect(member.visibility.torrents[0]?.diagnostics).toBeNull();
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member", restricted: true },
  });
  const demoted = await f.app.getMedia(f.owner, f.media.id);
  expect(demoted.visibility.torrents[0]?.diagnostics).toBeNull();
  expect(demoted.requests.map((row) => row.userId)).toEqual([f.owner.id]);
  expect(demoted.removalConfirmation).toBeUndefined();
  await f.db.plexIdentityMapping.update({
    where: { userId: f.owner.id },
    data: { permittedSectionIds: ["9"] },
  });
  await expect(f.app.getMedia(f.owner, f.media.id)).rejects.toMatchObject({
    code: "plex_library_access_required",
  });
});

test("shared torrent deduplicates visible collection work and never reveals hidden sibling metadata", async () => {
  await withTvVisibility(h.database(), true, async (f) => {
    await f.publish(h.context());
    const hidden = f.episodes.find((episode) => episode.id !== f.media.id);
    if (hidden === undefined) throw new Error("Missing shared TV sibling");
    expect([...f.attempt.mediaIds].sort()).toEqual(
      f.episodes.map((episode) => episode.id).sort(),
    );
    const complete = await f.app.getMedia(f.member, f.series.id);
    expect(complete.visibility.playback).toMatchObject({
      playableItems: 2,
      visibleItems: 2,
    });
    expect(complete.visibility.torrents).toHaveLength(1);
    // A hidden member remains part of physical authority, but its reader section
    // mapping is independently restricted. This is a visibility fault injection.
    const hiddenCurrent = await f.db.mediaItem.findUniqueOrThrow({
      where: { id: hidden.id },
    });
    await f.db.mediaItem.update({
      where: { id: hidden.id },
      data: {
        externalIds: {
          ...z.record(z.string(), z.json()).parse(hiddenCurrent.externalIds),
          plexSectionId: "9",
        },
      },
    });
    // The producer had full TV access. Revoke only the reader's hidden section.
    await f.db.plexIdentityMapping.update({
      where: { userId: f.member.id },
      data: { permittedSectionIds: ["1", "2"] },
    });
    const detail = await f.app.getMedia(f.member, f.series.id);
    expect(detail.visibility.playback).toMatchObject({
      scope: "collection",
      playable: true,
      playableItems: 1,
      visibleItems: 1,
      currentAssetId: null,
      currentVersion: null,
    });
    expect(detail.visibility.torrents).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain(hidden.id);
    expect(JSON.stringify(detail)).not.toContain(hidden.title);
    expect(
      await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.attempt.id },
      }),
    ).toMatchObject({ mediaIds: f.attempt.mediaIds });
  });
});

test("stale, future, missing and old epoch observations stay explicit; policy arithmetic does not grant cleanup", async () => {
  const f = await visibilityFixture(h.database());
  for (const [freshness, observedAt, epoch] of [
    ["missing", null, f.runtime.recoveryEpoch],
    ["stale", new Date(Date.now() - 600_000), f.runtime.recoveryEpoch],
    ["future", new Date(Date.now() + 600_000), f.runtime.recoveryEpoch],
    ["old_epoch", new Date(), -1],
  ] as const) {
    await f.db.torrent.update({
      where: { id: f.torrent.id },
      data: { observedAt, ownershipEpoch: epoch },
    });
    const current = await f.app.getMedia(f.owner, f.media.id);
    expect(current.visibility.torrents[0]?.freshness).toBe(freshness);
  }
  await f.db.torrent.update({
    where: { id: f.torrent.id },
    data: {
      ownershipEpoch: f.runtime.recoveryEpoch,
      observedAt: new Date(),
      seedingPolicy: {
        kind: "private",
        verified: true,
        ratio: 2,
        minimumSeconds: 100,
        combination: "all",
        sizeRule: null,
        evidence: "PRIVATE verification",
      },
      observation: {
        ...f.observation,
        torrent: {
          ...f.observation.torrent,
          progress: 1,
          ratio: { kind: "finite", value: 2 },
          seeding_time: 100,
          share_limit_action: "RemoveWithContent",
        },
      },
    },
  });
  const current = await f.app.getMedia(f.owner, f.media.id);
  const diagnostics = current.visibility.torrents[0]?.diagnostics;
  expect(diagnostics).toMatchObject({
    obligation: { satisfied: true, reason: "obligations_satisfied" },
    protections: expect.arrayContaining([
      "source_in_use",
      "torrent_policy_drift",
    ]),
  });
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE");
  await f.db.torrent.update({
    where: { id: f.torrent.id },
    data: { seedingPolicy: { kind: "unknown" } },
  });
  const unknown = await f.app.getMedia(f.owner, f.media.id);
  expect(unknown.visibility.torrents[0]?.diagnostics?.obligation).toMatchObject(
    { satisfied: false, reason: "policy_required" },
  );
});

test("reads are read-only; evaluation CAS refuses stale observation, policy and older results", async () => {
  const f = await visibilityFixture(h.database());
  const before = await f.db.torrent.findUniqueOrThrow({
    where: { id: f.torrent.id },
  });
  const counts = [
    await f.db.applicationEvent.count(),
    await f.db.operation.count(),
    await f.db.outboxCommand.count(),
  ];
  await f.app.getMedia(f.owner, f.media.id);
  await f.app.getMedia(f.member, f.media.id);
  expect(
    await f.db.torrent.findUniqueOrThrow({ where: { id: f.torrent.id } }),
  ).toEqual(before);
  expect([
    await f.db.applicationEvent.count(),
    await f.db.operation.count(),
    await f.db.outboxCommand.count(),
  ]).toEqual(counts);
  const input = {
    phase: "evaluation",
    status: "seeding",
    reason: "seeding_required",
    recoveryEpoch: f.runtime.recoveryEpoch,
    evaluatedAt: new Date(),
  } as const;
  expect(await recordCleanupEvaluation(f.db, before, input)).toBe(true);
  expect(
    await recordCleanupEvaluation(f.db, before, {
      ...input,
      evaluatedAt: new Date(input.evaluatedAt.getTime() - 1000),
    }),
  ).toBe(false);
  await f.db.torrent.update({
    where: { id: f.torrent.id },
    data: { observedAt: new Date(Date.now() + 1000) },
  });
  expect(await recordCleanupEvaluation(f.db, before, input)).toBe(false);
  const stale = await f.app.getMedia(f.owner, f.media.id);
  expect(stale.visibility.torrents[0]?.diagnostics?.cleanup?.freshness).toBe(
    "stale",
  );
});

test("unmapped episode inherits its actual series library, never an unrelated permitted library", async () => {
  const f = await visibilityFixture(h.database());
  const series = await f.db.mediaItem.create({
    data: {
      kind: "series",
      title: "Private series",
      externalIds: { plexSectionId: "2" },
    },
  });
  const season = await f.db.mediaItem.create({
    data: { kind: "season", title: "Private season", parentId: series.id },
  });
  const episode = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Private episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: { permittedSectionIds: ["9"], permittedMediaKinds: ["series"] },
  });
  const app = new PrismaMediaApplication(f.db, {
    keepDays: 30,
    serverMachineId: "visibility-fixture",
    visibilitySections: { movie: "1", series: "2" },
  });
  await expect(app.getMedia(f.member, episode.id)).rejects.toMatchObject({
    code: "plex_library_access_required",
  });
});
