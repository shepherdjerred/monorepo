import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { renderMediaMetrics } from "#infrastructure/metrics.ts";
import { visibilityFixture } from "./test-fixture.ts";
import { recordCleanupEvaluation } from "./seeding.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { rm } from "node:fs/promises";
import { withTvVisibility } from "./tv.test-support.ts";

const h = automationTestHarness();
function value(text: string, name: string): number {
  const line = text.split("\n").find((row) => row.startsWith(`${name} `));
  if (line === undefined) throw new Error(`Missing metric ${name}`);
  return Number(line.slice(name.length + 1));
}

test("empty database emits fixed zero cohorts; observed unknown/future epochs and delivery uncertainty are explicit", async () => {
  const db = h.database();
  const empty = await renderMediaMetrics(db);
  expect(empty).toContain('media_download_observations{state="missing"} 0');
  expect(empty).toContain(
    'media_notification_delivery_states{state="unknown"} 0',
  );
  const f = await visibilityFixture(db);
  const event = await db.applicationEvent.create({
    data: { kind: "media_available", mediaId: f.media.id, payload: {} },
  });
  await db.notificationDelivery.createMany({
    data: [
      {
        eventId: event.id,
        userId: f.owner.id,
        channel: "email",
        state: "unknown",
        recoveryEpoch: f.runtime.recoveryEpoch,
      },
      {
        eventId: event.id,
        userId: f.member.id,
        channel: "email",
        state: "rejected",
        recoveryEpoch: f.runtime.recoveryEpoch,
      },
    ],
  });
  await db.torrent.update({
    where: { id: f.torrent.id },
    data: { observedAt: new Date(Date.now() + 60_000) },
  });
  const before = await db.torrent.findUniqueOrThrow({
    where: { id: f.torrent.id },
  });
  const observed = await renderMediaMetrics(db);
  expect(observed).toContain('media_download_observations{state="future"} 1');
  expect(observed).toContain(
    'media_notification_delivery_states{state="unknown"} 1',
  );
  expect(observed).toContain(
    'media_notification_delivery_states{state="rejected"} 1',
  );
  expect(observed).not.toMatch(
    /PRIVATE|visibility-fixture|mediaId|userId|torrentId|path=/u,
  );
  expect(
    await db.torrent.findUniqueOrThrow({ where: { id: f.torrent.id } }),
  ).toEqual(before);
  await db.torrent.update({
    where: { id: f.torrent.id },
    data: { ownershipEpoch: -1 },
  });
  expect(await renderMediaMetrics(db)).toContain(
    'media_download_observations{state="old_epoch"} 1',
  );
});

test("aggregate cleanup bindings become stale on same-timestamp raw or policy drift", async () => {
  const f = await visibilityFixture(h.database());
  const input = {
    phase: "evaluation",
    status: "removable",
    reason: "obligations_satisfied",
    evaluatedAt: new Date(),
    recoveryEpoch: f.runtime.recoveryEpoch,
  } as const;
  expect(await recordCleanupEvaluation(f.db, f.torrent, input)).toBe(true);
  const initial = await renderMediaMetrics(f.db);
  const baseline = value(
    initial,
    'media_source_cleanup_evaluations{state="stale"}',
  );
  expect(
    value(initial, 'media_source_cleanup_evaluations{state="removable"}'),
  ).toBe(1);
  await f.db.torrent.update({
    where: { id: f.torrent.id },
    data: {
      observation: {
        ...f.observation,
        torrent: { ...f.observation.torrent, progress: 0.9 },
      },
    },
  });
  expect(
    value(
      await renderMediaMetrics(f.db),
      'media_source_cleanup_evaluations{state="stale"}',
    ),
  ).toBe(baseline + 1);
  const refreshed = await f.db.torrent.findUniqueOrThrow({
    where: { id: f.torrent.id },
  });
  expect(
    await recordCleanupEvaluation(f.db, refreshed, {
      ...input,
      evaluatedAt: new Date(),
    }),
  ).toBe(true);
  await f.db.torrent.update({
    where: { id: f.torrent.id },
    data: { seedingPolicy: { kind: "unknown" } },
  });
  expect(
    value(
      await renderMediaMetrics(f.db),
      'media_source_cleanup_evaluations{state="stale"}',
    ),
  ).toBe(baseline + 1);
});

test("watch cohort excludes cancelled roots and exclusions, includes direct+effective leaf only once and rejects future evidence", async () => {
  await withTvVisibility(h.database(), false, async (f) => {
    await f.publish();
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true },
    });
    const root = await f.cover(f.member);
    // Retain the existing TV claim while selecting its inherited source only.
    await f.db.mediaRequest.update({
      where: { id: f.request.id },
      data: { direct: false },
    });
    await f.db.watchState.create({
      data: {
        mediaId: f.media.id,
        userId: f.member.id,
        source: "plex",
        watched: false,
        observedAt: new Date(Date.now() + 60_000),
      },
    });
    expect(
      value(await renderMediaMetrics(f.db), "media_watch_evidence_required"),
    ).toBe(1);
    expect(
      value(
        await renderMediaMetrics(f.db),
        "media_watch_evidence_oldest_timestamp_seconds",
      ),
    ).toBe(0);
    await f.app.cancelRequest(
      f.member,
      crypto.randomUUID(),
      root.id,
      root.version,
    );
    expect(
      value(await renderMediaMetrics(f.db), "media_watch_evidence_required"),
    ).toBe(0);
    await f.app.createRequest(f.member, crypto.randomUUID(), {
      mediaId: f.media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    });
    await f.cover(f.member);
    const current = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: f.request.id },
    });
    expect(current).toMatchObject({
      active: true,
      direct: true,
      excluded: false,
    });
    expect(
      await f.db.requestCoverage.count({
        where: { requestId: current.id, active: true },
      }),
    ).toBe(1);
    expect(
      value(await renderMediaMetrics(f.db), "media_watch_evidence_required"),
    ).toBe(1);
    await f.db.watchState.update({
      where: {
        userId_mediaId_edition: {
          userId: f.member.id,
          mediaId: f.media.id,
          edition: "default",
        },
      },
      data: { observedAt: new Date() },
    });
    expect(
      value(
        await renderMediaMetrics(f.db),
        "media_watch_evidence_oldest_timestamp_seconds",
      ),
    ).toBeGreaterThan(0);
    await f.app.cancelRequest(
      f.member,
      crypto.randomUUID(),
      current.id,
      current.version,
    );
    expect(
      value(await renderMediaMetrics(f.db), "media_watch_evidence_required"),
    ).toBe(0);
  });
});

test("real file inspection advances ready to validating in exact acquisition gauges", async () => {
  const db = h.database();
  const before = await renderMediaMetrics(db);
  const f = await fileFixture(db);
  try {
    const acquired = await f.acquisition();
    const ready = await renderMediaMetrics(db);
    expect(value(ready, 'media_acquisition_attempts{state="ready"}')).toBe(
      value(before, 'media_acquisition_attempts{state="ready"}') + 1,
    );
    expect(
      await createMediaFileActivities(f.context).inspectAndStageMedia(
        acquired.input,
      ),
    ).toMatchObject({ status: "staged" });
    const row = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(row.state).toBe("validating");
    const validating = await renderMediaMetrics(db);
    expect(
      value(validating, 'media_acquisition_attempts{state="validating"}'),
    ).toBe(value(before, 'media_acquisition_attempts{state="validating"}') + 1);
    expect(value(validating, 'media_acquisition_attempts{state="ready"}')).toBe(
      value(before, 'media_acquisition_attempts{state="ready"}'),
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
