import { afterEach, expect, test } from "vitest";
import { GUILD, CHANNEL, USER, webFixture } from "./web-fixture.ts";
import { SnapshotSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { harness, number } from "#numbered-fixture";
import { elapsed } from "@shepherdjerred/streambot/web/client/api.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});
const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };

test("OAuth returns to a deep link and rejects external, escaped and unknown paths", async () => {
  fixture = webFixture();
  for (const returnTo of [
    "/history?visibility=server&q=Arrival&channel=2",
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
      returnTo.startsWith("/history?") ? returnTo : "/",
    );
  }
});

test("automatic web playback follows content and viewing another slot preserves a manual destination", async () => {
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
  async function play(url: string, viewed?: string) {
    if (fixture === undefined) throw new Error("Missing fixture");
    const snapshot = SnapshotSchema.parse(
      await fixture.playback.snapshot(fixture.session, GUILD, viewed),
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
  const video = await play("https://example.com/video");
  expect(video.status).toBe(200);
  expect(room.manager.numbered.selection.get(scope)).toBe(2);
  expect(
    room.manager.getExisting(GUILD, CHANNEL, number(1))?.view().current?.source
      ?.mode,
  ).toBe("music");
  room.manager.numbered.selection.select(scope, 3, 4);
  const manual = await play("https://example.com/manual", "1");
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

import { selectedGuildId } from "@shepherdjerred/streambot/web/client/route-state.ts";
test("stale or unauthorized server deep links recover to an available guild", () => {
  const guilds = [{ id: "available" }, { id: "second" }];
  expect(selectedGuildId(guilds, "stale")).toBe("available");
  expect(selectedGuildId(guilds, "second")).toBe("second");
  expect(selectedGuildId(guilds, null)).toBe("available");
  expect(selectedGuildId([], "stale")).toBe("");
});
