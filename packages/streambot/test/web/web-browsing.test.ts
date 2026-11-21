import { afterEach, expect, test } from "vitest";
import { GUILD, CHANNEL, USER, webFixture } from "./web-fixture.ts";
import { SnapshotSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { harness, number } from "#numbered-fixture";
import { elapsed } from "@shepherdjerred/streambot/web/client-classic/api.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});
const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };

test("OAuth returns to any page either remote serves and rejects external, escaped and unknown paths", async () => {
  fixture = webFixture();
  for (const returnTo of [
    "/history?visibility=server&q=Arrival&channel=2",
    "/music?q=Daft+Punk&album=aa997ea0-2936-40bd-884d-3af8a0e064dc",
    "/playlists?playlist=public-playlist&guild=100000000000000010",
    "/library?series=Severance",
    "/playlists/0b6f4b1e-0000-4000-8000-000000000000",
    "/playlists/0b6f4b1e-0000-4000-8000-000000000000?guild=100000000000000010",
    "/playlists?guild=100000000000000010&playlist=0b6f4b1e-0000-4000-8000-000000000000",
    "/album/MPREb_K8qWMWVqXGi",
    "/classic/plex",
    "https://evil.example/playlists?guild=100000000000000010",
    "/unknown?guild=100000000000000010&playlist=0b6f4b1e-0000-4000-8000-000000000000",
    "//evil.example/",
    String.raw`/\evil.example`,
    "/unknown",
    "/sports\n",
  ]) {
    const start = await fixture.handler(
      new Request(
        "http://127.0.0.1:8080/api/auth/discord/start?" +
          new URLSearchParams({ returnTo }).toString(),
      ),
    );
    const state = new URL(start.headers.get("location") ?? "").searchParams.get(
      "state",
    );
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const callback = await fixture.handler(
      new Request(
        "http://127.0.0.1:8080/api/auth/discord/callback?" +
          new URLSearchParams({
            code: "fixture",
            state: String(state),
          }).toString(),
        { headers: { cookie } },
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      [
        "/history?",
        "/music?",
        "/playlists?",
        "/library?",
        "/playlists/",
        "/album/",
        "/classic/",
      ].some((prefix) => returnTo.startsWith(prefix))
        ? returnTo
        : "/",
    );
  }
});

test("automatic web playback follows content and manual selection unifies view and destination", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    automatic: true,
    resolve: (source) => ({
      title: "A track",
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
  async function play(url: string) {
    if (fixture === undefined) throw new Error("Missing fixture");
    const snapshot = SnapshotSchema.parse(
      await fixture.playback.snapshot(fixture.session, GUILD),
    );
    return await fixture.handler(
      fixture.command({
        action: "play",
        placement: "queue",
        selection: { kind: "url", url },
        playbackChannel: snapshot.playbackChannel,
        revision: snapshot.revision,
        selectionVersion: snapshot.selectionVersion,
        slotRevisions: Object.fromEntries(
          snapshot.playbackChannels.map((slot) => [
            String(slot.number),
            slot.revision,
          ]),
        ),
      }),
    );
  }
  const music = await play("https://example.com/music");
  expect(music.status).toBe(200);
  expect(room.manager.numbered.selection.get(scope)).toBe(1);
  const afterMusic = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(afterMusic.playbackChannel).toBe(1);
  expect(afterMusic.selectedPlaybackChannel).toBeNull();
  const video = await play("https://example.com/video");
  expect(video.status).toBe(200);
  expect(room.manager.numbered.selection.get(scope)).toBe(2);
  const afterVideo = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(afterVideo.playbackChannel).toBe(2);
  expect(afterVideo.selectedPlaybackChannel).toBeNull();
  expect(
    room.manager.getExisting(GUILD, CHANNEL, number(1))?.view().current?.source
      ?.mode,
  ).toBe("music");
  room.manager.numbered.selection.select(scope, 3, 4);
  const manualSnapshot = SnapshotSchema.parse(
    await fixture.playback.snapshot(fixture.session, GUILD),
  );
  expect(manualSnapshot.playbackChannel).toBe(3);
  expect(manualSnapshot.selectedPlaybackChannel).toBe(3);
  const manual = await play("https://example.com/manual");
  expect(manual.status).toBe(200);
  expect(room.manager.getExisting(GUILD, CHANNEL, number(3))).not.toBeNull();
  expect(room.manager.numbered.selection.get(scope)).toBe(3);
});

test("duration uses clock fields through hour boundaries", () => {
  expect(elapsed(10_871)).toBe("3:01:11");
  expect(elapsed(3600)).toBe("1:00:00");
  expect(elapsed(59)).toBe("0:59");
  expect(elapsed(null)).toBe("—");
});

import { selectedGuildId } from "@shepherdjerred/streambot/web/client-classic/route-state.ts";
test("stale or unauthorized server deep links recover to an available guild", () => {
  const guilds = [{ id: "available" }, { id: "second" }];
  expect(selectedGuildId(guilds, "stale")).toBe("available");
  expect(selectedGuildId(guilds, "second")).toBe("second");
  expect(selectedGuildId(guilds, null)).toBe("available");
  expect(selectedGuildId([], "stale")).toBe("");
});
