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
  PlaybackTimelineSchema,
  type PlaybackTimelineItem,
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
  return PlaybackTimelineSchema.parse(read(path, persona, scenario));
}

function timedSessions(items: readonly PlaybackTimelineItem[]) {
  return items.flatMap((row) => (row.kind === "session" ? [row.session] : []));
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
    const keys = whole.items.map((row) =>
      row.kind === "session" ? row.session.id : row.id,
    );
    expect(new Set(keys).size).toBe(whole.items.length);
    expect(whole.items.some((row) => row.kind === "plex_view")).toBe(true);
    const started = whole.items.map((row) =>
      row.kind === "session" ? row.session.startedAt : row.viewedAt,
    );
    expect(started).toEqual([...started].sort().reverse());
    const legacy = PlaybackHistorySchema.parse(
      read("/playback/history?limit=25", "owner"),
    );
    expect(legacy.items).toEqual(timedSessions(whole.items).slice(0, 25));
  });

  it("has plays that link to a title and, among the older ones, plays that do not", async () => {
    const { items } = await readEveryPage((cursor) =>
      Promise.resolve(history(historyReadPath(EVERYTHING, cursor), "owner")),
    );
    const sessions = timedSessions(items);
    expect(sessions.some((play) => play.media !== null)).toBe(true);
    expect(sessions.some((play) => play.media === null)).toBe(true);
    expect(new Set(sessions.flatMap((play) => play.media?.kind ?? []))).toEqual(
      new Set(["movie", "episode"]),
    );
  });

  it("shows a member only their own plays, and the owner everyone's", () => {
    const mine = history(historyReadPath(EVERYTHING, null), "member");
    expect(
      new Set(timedSessions(mine.items).map((play) => play.userId)),
    ).toEqual(new Set([MEMBER.id]));
    expect(
      mine.items.every(
        (row) => row.kind === "session" || row.userName === MEMBER.displayName,
      ),
    ).toBe(true);
    const household = history(historyReadPath(EVERYTHING, null), "owner");
    expect(
      new Set(timedSessions(household.items).map((play) => play.userId)).size,
    ).toBeGreaterThan(2);
    // The owner's person filter narrows to one of them.
    const narrowed = history(
      historyReadPath({ ...EVERYTHING, person: MEMBER.id }, null),
      "owner",
    );
    expect(narrowed.items.length).toBeGreaterThan(0);
    expect(
      narrowed.items.every((row) =>
        row.kind === "session"
          ? row.session.userId === MEMBER.id
          : row.userName === MEMBER.displayName,
      ),
    ).toBe(true);
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
