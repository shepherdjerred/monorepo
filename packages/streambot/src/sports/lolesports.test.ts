import { describe, expect, it, vi } from "vitest";
import {
  LolEsportsClient,
  LOL_EVENTS_QUERY,
  lolBroadcasts,
  lolSportsEvent,
} from "./lolesports.ts";
import {
  sourceIdentity,
  SourceSchema,
} from "@shepherdjerred/streambot/sources/source.ts";
import { lolMatch } from "#lol-fixture";
const loopingResponse = () =>
  Response.json({
    data: {
      esports: { events: [lolMatch()], pages: { newer: "loop", older: null } },
    },
  });

describe("official LoL Esports catalog", () => {
  it("uses local calendar days, including a daylight-saving day longer than 24 hours", async () => {
    const first = { ...lolMatch(), id: "1", startTime: "2026-10-25T23:45:00Z" };
    const second = {
      ...lolMatch(),
      id: "2",
      startTime: "2026-10-26T04:00:00Z",
    };
    const third = { ...lolMatch(), id: "3", startTime: "2026-10-26T11:00:00Z" };
    const request = async () =>
      Response.json({
        data: {
          esports: {
            events: [first, second, third],
            pages: { newer: null, older: null },
          },
        },
      });
    const client = new LolEsportsClient(request, () =>
      Date.parse("2026-10-25T23:30:00Z"),
    );
    const signal = AbortSignal.timeout(1000);
    const la = await client.list(signal, {
      range: "today",
      timeZone: "America/Los_Angeles",
    });
    const seoul = await client.list(signal, {
      range: "today",
      timeZone: "Asia/Seoul",
    });
    expect(la.map((e) => e.id)).toEqual(["lolesports:1", "lolesports:2"]);
    expect(seoul).toHaveLength(3);
    const dstClient = new LolEsportsClient(
      async () =>
        Response.json({
          data: {
            esports: {
              events: [{ ...first, startTime: "2026-11-02T07:45:00Z" }],
              pages: { newer: null, older: null },
            },
          },
        }),
      () => Date.parse("2026-11-01T07:30:00Z"),
    );
    const dst = await dstClient.list(signal, {
      range: "today",
      timeZone: "America/Los_Angeles",
    });
    expect(dst).toHaveLength(1);
  });
  it("uses the current persisted query and follows newer pages without duplicate matches", async () => {
    const match = lolMatch();
    const request = vi.fn(async (url: URL) => {
      const variables: unknown = JSON.parse(
        url.searchParams.get("variables") ?? "{}",
      );
      expect(variables).toMatchObject({
        hl: "en-US",
        sport: "lol",
        leagues: ["98767975604431411"],
        eventType: "match",
      });
      expect(JSON.parse(url.searchParams.get("extensions") ?? "{}")).toEqual({
        persistedQuery: { version: 1, sha256Hash: LOL_EVENTS_QUERY },
      });
      const cursor = url.searchParams.get("variables")?.includes('"pageToken"');
      return Response.json({
        data: {
          esports: {
            events: [match],
            pages: { older: null, newer: cursor === true ? null : "next" },
          },
        },
      });
    });
    const events = await new LolEsportsClient(request, () =>
      Date.parse("2026-10-25T23:59:00Z"),
    ).list(AbortSignal.timeout(1000), { league: "worlds", range: "week" });
    expect(events).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(events[0]).toMatchObject({
      provider: "lolesports",
      status: "scheduled",
      lol: { eventId: match.id, bestOf: 3 },
    });
  });
  it("rejects API errors, corrupt match contracts, and looping cursors", async () => {
    const signal = AbortSignal.timeout(1000);
    await expect(
      new LolEsportsClient(
        async () => new Response(null, { status: 404 }),
      ).list(signal),
    ).rejects.toThrow("temporarily unavailable");
    await expect(
      new LolEsportsClient(async () => Response.json({ data: {} })).list(
        signal,
      ),
    ).rejects.toThrow();
    await expect(
      new LolEsportsClient(async () => loopingResponse()).list(signal),
    ).rejects.toThrow("repeated schedule cursor");
  });
  it("selects only unrestricted English YouTube and Twitch broadcasts in that order", () => {
    const match = lolMatch();
    expect(lolBroadcasts(match)).toEqual([
      "https://www.youtube.com/watch?v=5fD8Ker-Bic",
      "https://www.twitch.tv/riotgames",
    ]);
    expect(
      lolBroadcasts({
        ...match,
        streams: match.streams.map((s) => ({
          ...s,
          mediaLocale: { locale: "ko-KR" },
        })),
      }),
    ).toEqual([]);
    expect(
      lolBroadcasts({
        ...match,
        streams: match.streams.map((s) => ({ ...s, countries: ["KR"] })),
      }),
    ).toEqual([]);
  });
  it("retains TBD opponents and separates series on the same broadcast", () => {
    const match = lolMatch();
    match.matchTeams[0] = { name: "TBD", code: "TBD" };
    const event = lolSportsEvent(match);
    expect(event.title).toContain("TBD");
    const source = SourceSchema.parse({
      kind: "url",
      url: event.pageUrl,
      sportsEvent: event,
    });
    expect(sourceIdentity(source)).toBe(`lolesports:${match.id}`);
    expect(
      sourceIdentity(
        SourceSchema.parse({
          ...source,
          sportsEvent: { ...event, id: "lolesports:2" },
        }),
      ),
    ).not.toBe(sourceIdentity(source));
    expect(() => lolSportsEvent({ ...match, state: "completed" })).toThrow();
  });
});
