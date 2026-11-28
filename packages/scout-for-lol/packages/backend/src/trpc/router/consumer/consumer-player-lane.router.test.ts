import { describe, expect, test } from "vitest";
import { deriveTestLaneResults } from "#src/testing/report-lake/test-lane-results.ts";
import { createChampionPageTestEnv } from "#src/testing/consumer-champion-test-env.ts";
import { expectOneLakeSlot } from "#src/testing/consumer-profile-feature-test.ts";
import {
  AHRI,
  SYNDRA,
  VIEWER_MAIN,
  groupGames,
  lobby,
  mid,
} from "#src/testing/consumer-champion-group.ts";

/**
 * `consumerPlayer.profileSummary.lane`: "Ahead at 15 minutes in 11 of 19 lane
 * games", over the games the summary's own window covers, in its one lake slot.
 */

const { guildId, lakeDir, profileFeature, caller, seedGroup, writeLobbies } =
  await createChampionPageTestEnv("trpc-consumer-player-lane");

describe("consumerPlayer.profileSummary lane", () => {
  test("counts ahead of the games with a checkpoint across the player's accounts", async () => {
    profileFeature.enable(guildId);
    const { viewer } = await seedGroup();
    await writeLobbies(groupGames());
    await deriveTestLaneResults(lakeDir);

    const summary = await expectOneLakeSlot(
      async () =>
        await caller().consumerPlayer.profileSummary({ playerId: viewer.id }),
    );
    // Main plays 1h (mid, ahead), 6h (Jinx bottom, level) and 7h (ended before
    // 15:00, no checkpoint); the alt plays 2h (mid, behind). Four lane games,
    // three with a checkpoint, one of them ahead.
    expect(summary.lane).toEqual({ status: "available", games: 3, ahead: 1 });
  });

  test("covers the games window the summary uses", async () => {
    profileFeature.enable(guildId);
    const { viewer } = await seedGroup();
    // 22 games, newest first; the even ones lead at 15:00. The two oldest fall
    // outside the 20-game window.
    await writeLobbies(
      Array.from({ length: 22 }, (_, index) => {
        const n = index + 1;
        return lobby({
          n: 100 + n,
          hoursAgo: n,
          winner: 100,
          seats: [
            mid(VIEWER_MAIN, 100, AHRI, n % 2 === 0 ? 6000 : 4000),
            mid(null, 200, SYNDRA, 5000),
          ],
        });
      }),
    );
    await deriveTestLaneResults(lakeDir);

    const summary = await caller().consumerPlayer.profileSummary({
      playerId: viewer.id,
      games: 20,
    });
    expect(summary.recentForm?.games).toBe(20);
    expect(summary.lane).toEqual({ status: "available", games: 20, ahead: 10 });
  });

  test("is unavailable, not zero, while the lake predates lane_results", async () => {
    profileFeature.enable(guildId);
    const { viewer } = await seedGroup();
    await writeLobbies(groupGames());

    const summary = await expectOneLakeSlot(
      async () =>
        await caller().consumerPlayer.profileSummary({ playerId: viewer.id }),
    );
    expect(summary.lane).toEqual({ status: "unavailable" });
    // The rest of the summary is unaffected.
    expect(summary.recentForm?.games).toBe(4);
  });

  test("is unavailable when the current build derived no lane rows", async () => {
    profileFeature.enable(guildId);
    const { viewer } = await seedGroup();
    await writeLobbies(groupGames());
    await deriveTestLaneResults(lakeDir, { derive: false });

    const summary = await caller().consumerPlayer.profileSummary({
      playerId: viewer.id,
    });
    expect(summary.lane).toEqual({ status: "unavailable" });
  });
});
