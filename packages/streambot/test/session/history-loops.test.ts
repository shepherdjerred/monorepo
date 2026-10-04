import { expect, test, vi } from "vitest";
import {
  harness,
  guildId,
  voiceChannelId,
  statusChannelId,
  userId,
  number,
} from "#numbered-fixture";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { markReplacedRequest } from "@shepherdjerred/streambot/commands/playback-recording.ts";

test("natural track loops create individual history runs while pause, seek, and recovery reuse the open run", async () => {
  const history = new MediaHistoryStore(":memory:");
  const room = await harness(1, { history });
  const scope = { guildId, channelId: voiceChannelId, userId };
  const source = {
    kind: "search" as const,
    query: "Clip",
    mode: "video" as const,
  };
  const requestId = history.recordQueueRequest({
    scope,
    rawQuery: "Clip",
    intent: inferMediaIntent({ query: "Clip" }),
    media: { title: "Clip", provider: "youtube", source },
  });
  const handle = room.manager.ensureForPlay({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(2),
  });
  if (handle === null) throw new Error("Missing fixture account");
  const runs = () =>
    history.browseRuns({
      visibility: "mine",
      userId,
      guildId,
      provider: "",
      query: "",
      offset: 0,
    });
  handle.dispatch({ type: "ADD", source, requesterId: userId, requestId });
  await vi.waitFor(() => expect(runs().total).toBe(1));
  handle.dispatch({ type: "SET_LOOP", mode: "track" });
  const complete = room.completions[0];
  if (complete === undefined) throw new Error("Missing stream completion");
  complete();
  await vi.waitFor(() => expect(runs().total).toBe(2));
  expect(runs().items.filter((run) => run.ended_at !== null)).toHaveLength(1);
  handle.dispatch({ type: "PAUSE", positionSeconds: 12 });
  handle.dispatch({ type: "RESUME" });
  await vi.waitFor(() => expect(room.plays).toHaveLength(3));
  expect(await handle.seek(30)).toBe(true);
  handle.dispatch({
    type: "PRODUCER_STALLED",
    reason: "fixture",
    positionSeconds: 30,
  });
  await vi.waitFor(() => expect(room.plays).toHaveLength(4));
  handle.dispatch({ type: "RESTART" });
  await vi.waitFor(() => expect(room.plays).toHaveLength(5));
  expect(runs().total).toBe(2);
  markReplacedRequest({
    history,
    view: () => handle.view(),
  });
  const replacementId = history.recordQueueRequest({
    scope,
    rawQuery: "Replacement",
    intent: inferMediaIntent({ query: "Replacement" }),
  });
  handle.dispatch({
    type: "PLAY_NOW",
    source: { kind: "search", query: "Replacement", mode: "video" },
    requesterId: userId,
    requestId: replacementId,
  });
  await vi.waitFor(() => expect(runs().total).toBe(3));
  expect(
    runs().items.filter((run) => run.outcome === "completed"),
  ).toHaveLength(1);
  expect(runs().items.filter((run) => run.outcome === "skipped")).toHaveLength(
    1,
  );
  handle.dispatch({ type: "STOP" });
  await vi.waitFor(() =>
    expect(runs().items.every((run) => run.ended_at !== null)).toBe(true),
  );
  expect(runs().items.filter((run) => run.outcome === "skipped")).toHaveLength(
    2,
  );
});
