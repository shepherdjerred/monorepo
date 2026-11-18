import { afterEach, expect, test, vi } from "vitest";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";
import { harness, number } from "#numbered-fixture";
import { SnapshotSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { playerCommand } from "@shepherdjerred/streambot/web/client/api.ts";
import { resolveChannelDeepLink } from "@shepherdjerred/streambot/web/client/route-state.ts";

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

function startOnSlot(
  manager: Awaited<ReturnType<typeof harness>>["manager"],
  slot: number,
) {
  const handle = manager.ensureForPlay({
    guildId: GUILD,
    voiceChannelId: CHANNEL,
    statusChannelId: CHANNEL,
    playbackChannel: number(slot),
  });
  if (handle === null) throw new Error("No fixture account available");
  handle.dispatch({
    type: "ADD",
    requesterId: USER,
    source: {
      kind: "search",
      query: `clip-${String(slot)}`,
      mode: slot === 1 ? "music" : "video",
    },
  });
}

test("auto mode displays an occupied slot and follows routePlayback across music and video", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
    resolve: (source) => ({
      title: source.kind === "url" ? source.url : "Clip",
      chapters: [],
      ffmpegInput: "fixture",
      mediaKind:
        source.kind === "url" && source.url.includes("music")
          ? "music"
          : "video",
    }),
  });
  const room = await harness();
  fixture.playback.deps.sessions = room.manager;

  const idleSnapshot = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(idleSnapshot.selectionMode).toBe("auto");
  expect(idleSnapshot.playbackChannel).toBe(1);
  expect(idleSnapshot.selectedPlaybackChannel).toBeNull();

  // Another viewer starts video on slot 2 while slot 1 stays idle; Auto displays slot 2.
  startOnSlot(room.manager, 2);
  await vi.waitFor(() => {
    expect(
      room.manager.getExisting(GUILD, CHANNEL, number(2))?.view().state,
    ).toBe("streaming");
  });
  const slot2Active = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(slot2Active.selectionMode).toBe("auto");
  expect(slot2Active.playbackChannel).toBe(2);
  expect(slot2Active.selectedPlaybackChannel).toBeNull();
  expect(
    slot2Active.playbackChannels.map((slot) => [slot.number, slot.occupied]),
  ).toEqual([
    [1, false],
    [2, true],
    [3, false],
    [4, false],
  ]);

  // Playing music in Auto routes to slot 1 and updates Auto's displayed slot to 1.
  const playMusic = await fixture.handler(
    fixture.command(
      playerCommand(
        {
          action: "play",
          placement: "queue",
          selection: { kind: "url", url: "https://example.com/music" },
        },
        GUILD,
        slot2Active,
      ),
    ),
  );
  expect(playMusic.status).toBe(200);
  expect(room.manager.numbered.selection.lastTarget(scope)).toBe(1);
  const afterMusic = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(afterMusic.playbackChannel).toBe(1);
  expect(afterMusic.selectedPlaybackChannel).toBeNull();
  expect(
    afterMusic.playbackChannels.map((slot) => [slot.number, slot.occupied]),
  ).toEqual([
    [1, true],
    [2, true],
    [3, false],
    [4, false],
  ]);

  // Playing video in Auto routes to slot 2 and updates Auto's displayed slot to 2.
  const playVideo = await fixture.handler(
    fixture.command(
      playerCommand(
        {
          action: "play",
          placement: "queue",
          selection: { kind: "url", url: "https://example.com/video" },
        },
        GUILD,
        afterMusic,
      ),
    ),
  );
  expect(playVideo.status).toBe(200);
  expect(room.manager.numbered.selection.lastTarget(scope)).toBe(2);
  const afterVideo = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(afterVideo.playbackChannel).toBe(2);

  // Stopping slot 2 leaves lastTarget (2) idle, so Auto falls back to occupied slot 1.
  expect(
    await status(
      fixture.command(playerCommand({ action: "stop" }, GUILD, afterVideo)),
    ),
  ).toBe(200);
  const afterStopSlot2 = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(afterStopSlot2.playbackChannel).toBe(1);
  expect(afterStopSlot2.selectedPlaybackChannel).toBeNull();
});

test("manual select 1, 2, and null keep snapshot view and command destination unified", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
    resolve: () => ({
      title: "Clip",
      chapters: [],
      ffmpegInput: "fixture",
      mediaKind: "video",
    }),
  });
  const room = await harness();
  fixture.playback.deps.sessions = room.manager;
  startOnSlot(room.manager, 2);
  await vi.waitFor(() => {
    expect(
      room.manager.getExisting(GUILD, CHANNEL, number(2))?.view().state,
    ).toBe("streaming");
  });

  const initial = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(initial.playbackChannel).toBe(2);
  expect(
    await status(
      fixture.command(
        playerCommand({ action: "select", number: 1 }, GUILD, initial),
      ),
    ),
  ).toBe(200);

  const manual1 = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(manual1.selectionMode).toBe("manual");
  expect(manual1.playbackChannel).toBe(1);
  expect(manual1.selectedPlaybackChannel).toBe(1);
  expect(manual1.current).toBeNull();

  // /api/player ignores any legacy playbackChannel query parameter.
  const playerResponse = await fixture.handler(
    new Request(
      "http://127.0.0.1:8080/api/player?guildId=" +
        GUILD +
        "&playbackChannel=2",
      { headers: { cookie: fixture.cookie } },
    ),
  );
  expect(playerResponse.status).toBe(200);
  expect(
    SnapshotSchema.parse(await playerResponse.json()).playbackChannel,
  ).toBe(1);

  // Select channel 2 manually: snapshot and play destination both move to slot 2.
  expect(
    await status(
      fixture.command(
        playerCommand({ action: "select", number: 2 }, GUILD, manual1),
      ),
    ),
  ).toBe(200);
  const manual2 = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(manual2.selectionMode).toBe("manual");
  expect(manual2.playbackChannel).toBe(2);
  expect(manual2.selectedPlaybackChannel).toBe(2);
  expect(manual2.current?.title).toBe("Clip");

  // Sending a command with a mismatched playbackChannel in manual mode is rejected.
  expect(
    await status(
      fixture.command({
        ...playerCommand(
          {
            action: "play",
            placement: "queue",
            selection: { kind: "url", url: "https://example.com/mismatch" },
          },
          GUILD,
          manual2,
        ),
        playbackChannel: 1,
        revision: null,
      }),
    ),
  ).toBe(409);

  // Selecting null restores Auto mode.
  expect(
    await status(
      fixture.command(
        playerCommand({ action: "select", number: null }, GUILD, manual2),
      ),
    ),
  ).toBe(200);
  const restoredAuto = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(restoredAuto.selectionMode).toBe("auto");
  expect(restoredAuto.selectedPlaybackChannel).toBeNull();
  expect(restoredAuto.playbackChannel).toBe(2);
});

test("player-card channel deep links select valid slots unless already manually selected", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
  });
  const room = await harness();
  fixture.playback.deps.sessions = room.manager;
  startOnSlot(room.manager, 2);
  const autoSnapshot = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(resolveChannelDeepLink("2", autoSnapshot)).toBe(2);
  expect(resolveChannelDeepLink("1", autoSnapshot)).toBe(1);
  expect(resolveChannelDeepLink("0", autoSnapshot)).toBeNull();
  expect(resolveChannelDeepLink("5", autoSnapshot)).toBeNull();
  expect(resolveChannelDeepLink("auto", autoSnapshot)).toBeNull();

  room.manager.numbered.selection.select(scope, 2, 4);
  const manualSnapshot = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(resolveChannelDeepLink("2", manualSnapshot)).toBeNull();
  expect(resolveChannelDeepLink("1", manualSnapshot)).toBe(1);
  expect(
    resolveChannelDeepLink("2", { ...manualSnapshot, channel: null }),
  ).toBeNull();
  expect(
    resolveChannelDeepLink("2", { ...manualSnapshot, playbackChannel: null }),
  ).toBeNull();
});
