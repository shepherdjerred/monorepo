import { afterEach, expect, test, vi } from "vitest";
import { CHANNEL, GUILD, webFixture } from "./web-fixture.ts";
import { harness, number } from "#numbered-fixture";

let fixture: ReturnType<typeof webFixture>;
async function status(request: Request) {
  const response = await fixture.handler(request);
  return response.status;
}
afterEach(() => {
  fixture.close();
});
async function numberedFixture() {
  fixture = webFixture();
  const room = await harness();
  fixture.playback.deps.sessions = room.manager;
  return room;
}

test("web audio and video commands reach distinct actors and preserve fixed transports", async () => {
  const { manager, plays } = await numberedFixture();
  const play = (playbackChannel: number, transport: "listen" | "watch") =>
    fixture.command({
      action: "play",
      playbackChannel,
      transport,
      placement: "queue",
      selection: { kind: "url", url: "https://example.com/clip" },
    });
  expect(await status(play(1, "listen"))).toBe(200);
  await vi.waitFor(() => {
    expect(manager.getExisting(GUILD, CHANNEL, number(1))?.view().state).toBe(
      "streaming",
    );
  });
  expect(await status(play(2, "watch"))).toBe(200);
  await vi.waitFor(() => {
    expect(manager.getExisting(GUILD, CHANNEL, number(2))?.view().state).toBe(
      "streaming",
    );
  });
  await expect
    .poll(() => plays.map((entry) => entry.transport))
    .toEqual(["music", "video"]);
  const videoRevision = manager.revision(GUILD, CHANNEL, number(2));
  expect(
    await status(
      fixture.command({
        action: "stop",
        playbackChannel: 2,
        revision: videoRevision,
      }),
    ),
  ).toBe(200);
  expect(manager.getExisting(GUILD, CHANNEL, number(1))?.view().state).toBe(
    "streaming",
  );
});

test("a voice move while media resolves rejects dispatch and releases the unused slot", async () => {
  const { manager, entries } = await numberedFixture();
  fixture.setBeforeResolve(() => {
    fixture.setChannel(null);
  });
  const response = await fixture.handler(
    fixture.command({
      action: "play",
      playbackChannel: 1,
      transport: "listen",
      placement: "queue",
      selection: { kind: "url", url: "https://example.com/clip" },
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "channel_changed" });
  await vi.waitFor(() => {
    expect(entries.every((entry) => !entry.busy)).toBe(true);
  });
  expect(manager.getExisting(GUILD, CHANNEL, number(1))).toBeNull();
});
