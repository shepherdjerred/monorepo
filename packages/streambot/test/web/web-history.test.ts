import { afterEach, expect, test } from "vitest";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { HistoryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { GUILD, CHANNEL, USER, webFixture } from "./web-fixture.ts";
import { FIXTURE_EVENTS } from "./web-fixture-media.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
let history: MediaHistoryStore | undefined;
afterEach(() => {
  fixture?.close();
  history?.close();
  fixture = undefined;
  history = undefined;
});

test("history is sanitized and an event ending after browsing is rejected before allocation", async () => {
  history = new MediaHistoryStore(":memory:");
  let today = FIXTURE_EVENTS;
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    history,
    sports: {
      listToday: () => Promise.resolve(today),
      search: () => Promise.resolve({ kind: "not-found" }),
    },
  });
  const event = FIXTURE_EVENTS[0];
  if (event === undefined) throw new Error("Missing event");
  const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };
  const media = {
    title: event.title,
    provider: event.provider,
    source: { kind: "url" as const, url: event.pageUrl, sportsEvent: event },
  };
  const requestId = history.recordQueueRequest({
    scope,
    media,
    rawQuery: event.title,
    intent: inferMediaIntent({ query: event.title }),
  });
  history.recordPlaybackStart({ scope, media, requestId });
  const response = await fixture.handler(
    new Request("http://127.0.0.1:8080/api/history?guildId=" + GUILD, {
      headers: { cookie: fixture.cookie },
    }),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(event.pageUrl);
  expect(text).not.toContain("source_json");
  const page = HistoryPageSchema.parse(JSON.parse(text));
  expect(page.items[0]?.replayAvailable).toBe(true);
  expect(page.items[0]?.requester?.name).toBe("jerred");
  today = [];
  const replay = await fixture.handler(
    fixture.command({
      action: "play",
      placement: "queue",
      selection: { kind: "history", id: page.items[0]?.id },
    }),
  );
  expect(replay.status).toBe(409);
  expect(fixture.allocations()).toBe(0);
});

test("history obeys server authorization and its existing feature gate", async () => {
  fixture = webFixture();
  const disabled = await fixture.handler(
    new Request("http://127.0.0.1:8080/api/history?guildId=" + GUILD, {
      headers: { cookie: fixture.cookie },
    }),
  );
  const denied = await fixture.handler(
    new Request(
      "http://127.0.0.1:8080/api/history?guildId=100000000000000011",
      { headers: { cookie: fixture.cookie } },
    ),
  );
  expect(disabled.status).toBe(403);
  expect(denied.status).toBe(403);
});
