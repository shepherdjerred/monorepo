import { afterEach, expect, test, vi } from "vitest";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";
import { harness, number } from "#numbered-fixture";
import { SnapshotSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";

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
const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };

test("web selection shares Discord's personal channel without allocating an account", async () => {
  const { manager, entries } = await numberedFixture();
  const snapshot = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(snapshot.playbackChannel).toBe(1);
  expect(snapshot.playbackChannels.map((slot) => slot.number)).toEqual([
    1, 2, 3, 4,
  ]);
  const stale = fixture.command({ action: "stop", playbackChannel: 1 });
  expect(
    await status(
      fixture.command({ action: "select", number: 2, playbackChannel: 1 }),
    ),
  ).toBe(200);
  expect(manager.numbered.selection.get(scope)).toBe(2);
  expect(entries.every((entry) => !entry.busy)).toBe(true);
  expect(await status(stale)).toBe(409);
  expect(
    await status(
      fixture.command({ action: "select", number: 5, playbackChannel: 2 }),
    ),
  ).toBe(400);
  expect(
    manager.numbered.selection.get({ ...scope, userId: "another-viewer" }),
  ).toBe(1);
});

test("web audio and video commands reach distinct actors and preserve fixed transports", async () => {
  const { manager, plays } = await numberedFixture();
  const play = (playbackChannel: number) =>
    fixture.command({
      action: "play",
      playbackChannel,
      placement: "queue",
      selection: { kind: "url", url: "https://example.com/clip" },
    });
  expect(await status(play(1))).toBe(200);
  await vi.waitFor(() => {
    expect(manager.getExisting(GUILD, CHANNEL, number(1))?.view().state).toBe(
      "streaming",
    );
  });
  manager.numbered.selection.select(scope, 2, 4);
  expect(await status(play(2))).toBe(200);
  await vi.waitFor(() => {
    expect(manager.getExisting(GUILD, CHANNEL, number(2))?.view().state).toBe(
      "streaming",
    );
  });
  expect(plays.map((entry) => entry.transport)).toEqual(["music", "video"]);
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

test("personal channel changes while media resolves reject dispatch and release the unused slot", async () => {
  const { manager, entries } = await numberedFixture();
  fixture.setBeforeResolve(() => {
    manager.numbered.selection.select(scope, 2, 4);
  });
  const response = await fixture.handler(
    fixture.command({
      action: "play",
      playbackChannel: 1,
      placement: "queue",
      selection: { kind: "url", url: "https://example.com/clip" },
    }),
  );
  expect(response.status).toBe(409);
  await vi.waitFor(() => {
    expect(entries.every((entry) => !entry.busy)).toBe(true);
  });
  expect(manager.getExisting(GUILD, CHANNEL, number(1))).toBeNull();
});
