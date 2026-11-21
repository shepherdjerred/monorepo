import { describe, expect, it } from "vitest";
import {
  EVERYTHING,
  historyReadPath,
  statisticsReadPath,
} from "#client/history/view.ts";
import { readEveryPage } from "#client/ui/use-cursor-list.ts";
import {
  NowPlayingSchema,
  PlaybackHistorySchema,
  PlaybackStatisticsSchema,
} from "#shared/household/playback.ts";
import type { Persona } from "./personas.ts";
import { MEMBER } from "./personas.ts";
import { routeFixture } from "./router.ts";
import type { FixtureScenario } from "./scenario.ts";

/** One playback read, as the client makes it. */
function read(
  path: string,
  persona: Persona,
  scenario: FixtureScenario = "default",
): unknown {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v1${path}`),
    persona,
    scenario,
  });
  if (outcome.status !== 200) {
    throw new Error(`${path}: HTTP ${String(outcome.status)}`);
  }
  return outcome.body;
}

function history(path: string, persona: Persona, scenario?: FixtureScenario) {
  return PlaybackHistorySchema.parse(read(path, persona, scenario));
}

describe("the playback fixture", () => {
  it("fills more than two pages of the History list, and the pages do not overlap", async () => {
    const first = history(historyReadPath(EVERYTHING, null), "owner");
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    let reads = 0;
    const whole = await readEveryPage((cursor) => {
      reads += 1;
      return Promise.resolve(
        history(historyReadPath(EVERYTHING, cursor), "owner"),
      );
    });
    expect(reads).toBeGreaterThan(2);
    expect(new Set(whole.items.map((play) => play.id)).size).toBe(
      whole.items.length,
    );
    // Newest first.
    const started = whole.items.map((play) => play.startedAt);
    expect(started).toEqual([...started].sort().reverse());
  });

  it("has plays that link to a title and, among the older ones, plays that do not", async () => {
    const { items } = await readEveryPage((cursor) =>
      Promise.resolve(history(historyReadPath(EVERYTHING, cursor), "owner")),
    );
    expect(items.some((play) => play.media !== null)).toBe(true);
    expect(items.some((play) => play.media === null)).toBe(true);
    expect(new Set(items.flatMap((play) => play.media?.kind ?? []))).toEqual(
      new Set(["movie", "episode"]),
    );
  });

  it("shows a member only their own plays, and the owner everyone's", () => {
    const mine = history(historyReadPath(EVERYTHING, null), "member");
    expect(new Set(mine.items.map((play) => play.userId))).toEqual(
      new Set([MEMBER.id]),
    );
    const household = history(historyReadPath(EVERYTHING, null), "owner");
    expect(
      new Set(household.items.map((play) => play.userId)).size,
    ).toBeGreaterThan(2);
    // The owner's person filter narrows to one of them.
    const narrowed = history(
      historyReadPath({ ...EVERYTHING, person: MEMBER.id }, null),
      "owner",
    );
    expect(narrowed.items.length).toBeGreaterThan(0);
    expect(narrowed.items.every((play) => play.userId === MEMBER.id)).toBe(
      true,
    );
  });

  it("counts the plays the filters leave", () => {
    const all = PlaybackStatisticsSchema.parse(
      read(statisticsReadPath(EVERYTHING), "owner"),
    );
    const bear = PlaybackStatisticsSchema.parse(
      read(statisticsReadPath({ ...EVERYTHING, search: "bear" }), "owner"),
    );
    expect(all.plays).toBeGreaterThan(bear.plays);
    expect(bear.plays).toBeGreaterThan(0);
    expect(bear.topTitles.map((row) => row.label)).toEqual(["The Bear"]);
    expect(all.topTitles.length).toBeGreaterThan(3);
    expect(all.topUsers.length).toBeGreaterThan(2);
    expect(all.completedPlays).toBeLessThan(all.plays);
  });

  it("is empty for a household that has watched nothing", () => {
    expect(
      history(historyReadPath(EVERYTHING, null), "owner", "new-household"),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      PlaybackStatisticsSchema.parse(
        read(statisticsReadPath(EVERYTHING), "owner", "new-household"),
      ).plays,
    ).toBe(0);
    expect(
      NowPlayingSchema.parse(
        read("/playback/now-playing", "owner", "new-household"),
      ),
    ).toMatchObject({ stale: false, items: [] });
  });
});
