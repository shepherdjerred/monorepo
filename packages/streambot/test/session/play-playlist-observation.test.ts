import { afterEach, expect, test } from "vitest";
import { playRequestsTotal } from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { fakeInteraction, makeHandler } from "./command-handler-fixture.ts";

const items = [1, 2, 3].map((n) => ({
  url: `https://youtube.com/watch?v=${String(n)}`,
  title: `song ${String(n)}`,
}));

async function slashPlayRequests(): Promise<{ ok: number; notOk: number }> {
  const { values } = await playRequestsTotal.get();
  const slash = values.filter((value) => value.labels.surface === "slash");
  const sum = (ok: boolean) =>
    slash
      .filter((value) => (value.labels.outcome === "ok") === ok)
      .reduce((total, value) => total + value.value, 0);
  return { ok: sum(true), notOk: sum(false) };
}

function playlistInteraction() {
  return fakeInteraction({
    sub: "play",
    strings: { query: "https://youtube.com/playlist?list=PL123" },
  }).interaction;
}

afterEach(() => {
  playRequestsTotal.reset();
});

test("an automatically routed playlist of N tracks counts one ok play request", async () => {
  const h = makeHandler({ playlistItems: items, routed: true });
  await h.handler.run(playlistInteraction());
  expect(h.events).toHaveLength(items.length);
  expect(await slashPlayRequests()).toEqual({ ok: 1, notOk: 0 });
});

test("an automatically routed playlist failing midway counts one failure and no ok", async () => {
  const h = makeHandler({
    playlistItems: items,
    routed: true,
    resolvePlayError: new Error("resolver down"),
    resolvePlayErrorAfter: 1,
  });
  await expect(h.handler.run(playlistInteraction())).rejects.toThrow(
    "resolver down",
  );
  expect(h.events).toHaveLength(1);
  expect(await slashPlayRequests()).toEqual({ ok: 0, notOk: 1 });
});
