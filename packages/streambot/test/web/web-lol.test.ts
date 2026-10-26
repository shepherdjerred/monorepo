import { afterEach, expect, test } from "vitest";
import { webFixture, GUILD, CHANNEL, USER } from "#web-fixture";
import { LolPlaybackSchedules } from "@shepherdjerred/streambot/sports/playback-schedules.ts";
import { lolSportsEvent } from "@shepherdjerred/streambot/sports/lolesports.ts";
import { SportsResultsSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ScheduleResultsSchema } from "@shepherdjerred/streambot/sports/schedule-types.ts";
import { lolMatch } from "#lol-fixture";
const origin = "http://127.0.0.1:8080";
let fixture: ReturnType<typeof webFixture> | undefined;
let schedules: LolPlaybackSchedules | undefined;
afterEach(() => {
  fixture?.close();
  schedules?.close();
});

test("web scheduling verifies identity, CSRF, voice membership and the selected video slot", async () => {
  const match = lolMatch();
  const event = lolSportsEvent(match);
  schedules = new LolPlaybackSchedules(
    ":memory:",
    { find: async () => match },
    {
      allowed: async () => true,
      authority: async () => ({ allowed: true, listeners: true }),
      slot: () => ({ idle: true }),
      start: async () => "busy",
      stop: () => {
        throw new Error("No stream was started");
      },
    },
  );
  fixture = webFixture(origin, undefined, false, {
    schedules,
    lol: true,
    sports: {
      listToday: async () => [event],
      listSchedule: async () => [event],
      search: async () => ({ kind: "upcoming", event }),
    },
  });
  fixture.enableNumbered(3);
  const headers = {
    cookie: fixture.cookie,
    origin,
    "x-csrf-token": fixture.csrf,
    "content-type": "application/json",
  };
  const browse = await fixture.handler(
    new Request(
      `${origin}/api/sports?guildId=${GUILD}&provider=lolesports&range=week`,
      { headers },
    ),
  );
  const events = SportsResultsSchema.parse(await browse.json());
  expect(events[0]?.canSchedule).toBe(true);
  const create = () =>
    new Request(origin + "/api/sports/schedules", {
      method: "POST",
      headers,
      body: JSON.stringify({
        guildId: GUILD,
        selectionId: events[0]?.id,
        userId: "attacker",
        channelId: "attacker",
      }),
    });
  const accepted = await fixture.handler(create());
  expect(accepted.status).toBe(200);
  const stored = schedules.list(GUILD, USER);
  expect(stored[0]).toMatchObject({
    slot: 3,
    channelId: CHANNEL,
    status: "pending",
  });
  for (const endpoint of [
    "/api/sports/schedules",
    "/api/sports/schedules/cancel",
  ]) {
    const malformed = await fixture.handler(
      new Request(origin + endpoint, {
        method: "POST",
        headers,
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "invalid_request" });
  }
  expect(schedules.list(GUILD, "attacker")).toEqual([]);
  const list = await fixture.handler(
    new Request(`${origin}/api/sports/schedules?guildId=${GUILD}`, { headers }),
  );
  expect(ScheduleResultsSchema.parse(await list.json())).toHaveLength(1);
  const forged = await fixture.handler(
    new Request(origin + "/api/sports/schedules", {
      method: "POST",
      headers: { ...headers, "x-csrf-token": "wrong" },
      body: JSON.stringify({ guildId: GUILD }),
    }),
  );
  expect(forged.status).toBe(403);
  fixture.setChannel(null);
  const absent = await fixture.handler(create());
  expect(absent.status).toBe(409);
  const cancelled = await fixture.handler(
    new Request(origin + "/api/sports/schedules/cancel", {
      method: "POST",
      headers,
      body: JSON.stringify({ guildId: GUILD, id: stored[0]?.id }),
    }),
  );
  expect(cancelled.status).toBe(200);
  expect(schedules.list(GUILD, USER)[0]?.status).toBe("cancelled");
});

test("LoL browsing is independently gated", async () => {
  const event = lolSportsEvent(lolMatch());
  fixture = webFixture(origin, undefined, false, {
    sports: {
      listToday: async () => [event],
      listSchedule: async () => [event],
      search: async () => ({ kind: "upcoming", event }),
    },
  });
  const response = await fixture.handler(
    new Request(`${origin}/api/sports?guildId=${GUILD}&provider=lolesports`, {
      headers: { cookie: fixture.cookie },
    }),
  );
  expect(response.status).toBe(403);
});
