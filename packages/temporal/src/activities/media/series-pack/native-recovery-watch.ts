import { expect } from "vitest";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import { createPlexWatchActivities } from "#activities/media/plex-watch.ts";
import {
  nativeSeriesPackPaidV1,
  nativeRecoverySdk,
} from "./native-recovery-phases.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;

/** Two actual cursor Activities each resolve one complete target and retain
 * their own original pre-lazy SDK/100. No requester cohort is truncated. */
export async function assertNativeSeriesPackWatchV1(
  scenario: Fixture,
  charges: { method: string; paid: number }[],
) {
  const watch = createPlexWatchActivities(() =>
    Promise.resolve({ plexWatch: scenario.plexWatch }),
  );
  let cursor = "series-pack-native-tv-watch-v1:start";
  const completed = new Set<string>();
  for (let page = 0; page < 2; page++) {
    const result = await nativeSeriesPackPaidV1(
      `watch_cursor_${String(page)}`,
      charges,
      () =>
        nativeRecoverySdk(
          crypto.randomUUID(),
          `native-watch-${String(page)}`,
        ).run(watch.sweepMediaWork, {
          kind: "watch",
          cursor,
          sweepId: crypto.randomUUID(),
        }),
    );
    expect(result.processed).toBe(1);
    if (result.nextCursor === null)
      throw new Error(
        "Actual native watch cursor lost its remaining TV targets",
      );
    expect(result.nextCursor).not.toBe(cursor);
    cursor = result.nextCursor;
    const observed = await scenario.db.plexWatchProjection.findMany({
      where: {
        mediaId: { in: scenario.mediaIds },
        edition: "default",
        evidence: {
          evidence: { path: ["group", "ownershipEpoch"], equals: 1 },
        },
        watched: true,
      },
    });
    expect(new Set(observed.map((row) => row.mediaId)).size).toBe(page + 1);
    for (const row of observed) completed.add(row.mediaId);
  }
  expect(completed.size).toBe(2);
  expect(
    await scenario.db.operation.count({
      where: {
        kind: "retain_media",
        targetId: { in: [...completed] },
        payload: { path: ["recoveryEpoch"], equals: 1 },
      },
    }),
  ).toBe(2);
  expect(
    await scenario.db.applicationEvent.count({
      where: {
        kind: "series_pack_native_watch_protected",
        mediaId: { in: scenario.mediaIds },
      },
    }),
  ).toBe(0);
}
