import { afterEach, describe, expect, test, vi } from "vitest";
import { WebAuth } from "@shepherdjerred/streambot/web/server/auth.ts";
import { Selections } from "@shepherdjerred/streambot/web/server/selections.ts";
import { WebActions } from "@shepherdjerred/streambot/web/server/actions.ts";
import {
  CommandSchema,
  CommandResultSchema,
  IdentitySchema,
  LibraryPageSchema,
  SnapshotSchema,
  SubtitleMenuSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture>;
afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
});
async function status(request: Request): Promise<number> {
  const response = await fixture.handler(request);
  return response.status;
}

describe("authenticated web playback", () => {
  test("authentication, CSRF and current membership protect media and mutations", async () => {
    fixture = webFixture();
    expect(
      await status(
        new Request("http://127.0.0.1:8080/api/library?guildId=" + GUILD),
      ),
    ).toBe(401);
    const request = fixture.command({
      action: "play",
      selection: { kind: "url", url: "https://example.com/video" },
      placement: "queue",
    });
    request.headers.delete("x-csrf-token");
    expect(await status(request)).toBe(403);
    fixture.setMember(false);
    expect(await status(fixture.command({ action: "stop" }))).toBe(403);
    fixture.setMember(true);
    fixture.setEnabled(false);
    expect(await status(fixture.command({ action: "stop" }))).toBe(403);
    expect(fixture.allocations()).toBe(0);
    expect(fixture.events).toHaveLength(0);
  });

  test("library and search are sanitized and never acquire a userbot", async () => {
    fixture = webFixture();
    const request = new Request(
      "http://127.0.0.1:8080/api/library?guildId=" + GUILD,
      { headers: { cookie: fixture.cookie } },
    );
    const response = await fixture.handler(request);
    const body = await response.text();
    const page = LibraryPageSchema.parse(JSON.parse(body));
    expect(page.items).toHaveLength(6);
    expect(body).not.toContain("/media/");
    expect(body).not.toContain("relativePath");
    const search = await fixture.catalog.search(
      new URLSearchParams({ query: "Arrival", source: "local" }),
      { guildId: GUILD, channelId: CHANNEL, userId: USER },
      "owner",
      new AbortController().signal,
    );
    expect(search[0]?.title).toBe("Arrival");
    expect(JSON.stringify(search)).not.toContain("/media/");
    expect(fixture.allocations()).toBe(0);
  });

  test("URL play retains the real requester and uses the shared command service", async () => {
    fixture = webFixture();
    const response = await fixture.handler(
      fixture.command({
        action: "play",
        selection: { kind: "url", url: "https://example.com/video" },
        placement: "queue",
      }),
    );
    expect(response.status).toBe(200);
    expect(CommandResultSchema.parse(await response.json()).message).toContain(
      "Queued",
    );
    expect(fixture.events[0]).toMatchObject({
      type: "ADD",
      requesterId: USER,
      source: { kind: "url", url: "https://example.com/video" },
    });
    expect(fixture.allocations()).toBe(1);
  });

  test("same-channel viewers share web controls while default command permissions remain", async () => {
    fixture = webFixture();
    await fixture.seed();
    const defaults = new PlaybackCommandService({
      ...fixture.playback.deps.commands,
      announce: () => Promise.resolve(),
      view: fixture.handle.view,
      dispatch: fixture.handle.dispatch,
      seek: fixture.handle.seek,
      setVolume: fixture.handle.setVolume,
    });
    expect(() => defaults.stop(USER)).toThrow("Only an admin");
    expect(() => defaults.skip(USER)).toThrow("requester");
    expect(await status(fixture.command({ action: "pause" }))).toBe(200);
    expect(fixture.events.at(-1)?.type).toBe("PAUSE");
  });

  test("a stale queue revision cannot remove an item even after identical media repeats", async () => {
    fixture = webFixture();
    await fixture.seed();
    const stale = fixture.command({ action: "remove", position: 1 });
    fixture.handle.dispatch({
      type: "ADD",
      source: {
        kind: "file",
        path: "/media/movies/arrival.mkv",
        title: "Arrival",
      },
      requesterId: USER,
    });
    const before = fixture.events.length;
    expect(await status(stale)).toBe(409);
    expect(fixture.events).toHaveLength(before);
    const snapshot = SnapshotSchema.parse(
      await fixture.playback.snapshot(fixture.session, GUILD),
    );
    expect(snapshot.queue[0]?.title).toBe("Arrival");
    expect(JSON.stringify(snapshot)).not.toContain("/media/");
  });

  test("voice moves during resolution reject play without dispatching it", async () => {
    fixture = webFixture();
    await fixture.seed();
    fixture.setBeforeResolve(() => {
      fixture.setChannel(null);
    });
    const response = await fixture.handler(
      fixture.command({
        action: "play",
        selection: { kind: "url", url: "https://example.com/video" },
        placement: "now",
      }),
    );
    expect(response.status).toBe(409);
    expect(fixture.events).toHaveLength(0);
  });

  test("disabled advanced controls cannot be invoked through the API", async () => {
    fixture = webFixture();
    await fixture.seed();
    fixture.setAdvanced(false);
    expect(await status(fixture.command({ action: "pause" }))).toBe(403);
    expect(fixture.events).toHaveLength(0);
  });

  test("subtitles expose opaque actual tracks and reject a picker after playback changes", async () => {
    fixture = webFixture();
    await fixture.seed();
    const actions = new WebActions(fixture.playback);
    const input = CommandSchema.parse({
      action: "subtitles",
      token: "enumerate",
      guildId: GUILD,
      channelId: CHANNEL,
      revision: fixture.revision(),
    });
    if (input.action !== "subtitles")
      throw new Error("Expected subtitle command");
    const menu = SubtitleMenuSchema.parse(
      await actions.subtitles(
        fixture.session,
        input,
        new AbortController().signal,
      ),
    );
    expect(menu.tracks.map((track) => track.label)).toEqual([
      "Off",
      "en · sidecar",
      "fr · embedded",
    ]);
    expect(JSON.stringify(menu)).not.toContain("/private/");
    const token = menu.tracks[1]?.token;
    if (token === undefined) throw new Error("Expected sidecar track");
    await actions.execute(
      fixture.session,
      { ...input, token },
      new AbortController().signal,
    );
    expect(fixture.events.at(-1)).toMatchObject({
      type: "CHANGE_SUBTITLES",
      subtitles: {
        trackRef: { kind: "sidecar", file: "/private/arrival.en.srt" },
      },
    });
    await expect(
      actions.execute(
        fixture.session,
        { ...input, token },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Playback or the queue changed");
  });

  test("invalid subtitle enumeration cannot allocate a playback session", async () => {
    fixture = webFixture();
    const request = fixture.command({
      action: "play",
      placement: "queue",
      selection: { kind: "url", url: "https://example.com/video" },
    });
    const response = await fixture.handler(
      new Request("http://127.0.0.1:8080/api/subtitles", request),
    );
    expect(response.status).toBe(400);
    expect(fixture.allocations()).toBe(0);
  });
});

describe("web sign-in and references", () => {
  test("malformed client input is rejected while corrupt server sessions fail as unavailable", async () => {
    fixture = webFixture();
    const malformed = new Request("http://127.0.0.1:8080/api/commands", {
      method: "POST",
      headers: {
        cookie: fixture.cookie,
        origin: "http://127.0.0.1:8080",
        "x-csrf-token": fixture.csrf,
        "content-type": "application/json",
      },
      body: "{",
    });
    expect(await status(malformed)).toBe(400);
    vi.spyOn(fixture.store, "read").mockImplementation(() => {
      IdentitySchema.parse({});
      return null;
    });
    const response = await fixture.handler(
      new Request("http://127.0.0.1:8080/api/me", {
        headers: { cookie: fixture.cookie },
      }),
    );
    expect(response.status).toBe(503);
    expect(fixture.events).toHaveLength(0);
  });

  test("OAuth state is cookie-bound, single-use and production cookies are secure", async () => {
    fixture = webFixture("https://streambot.sjer.red");
    const start = await fixture.handler(
      new Request("https://streambot.sjer.red/api/auth/discord/start"),
    );
    const target = new URL(start.headers.get("location") ?? "");
    expect(target.searchParams.get("scope")).toBe("identify guilds");
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const callback =
      "https://streambot.sjer.red/api/auth/discord/callback?code=fixture&state=" +
      (target.searchParams.get("state") ?? "");
    const response = await fixture.handler(
      new Request(callback, { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("streambot_session=")),
    ).toContain("HttpOnly; Secure");
    expect(await status(new Request(callback, { headers: { cookie } }))).toBe(
      400,
    );
    const auth = new WebAuth({
      bootstrap: {
        publicOrigin: "https://streambot.sjer.red",
        clientSecret: "fixture",
        port: 8080,
      },
      applicationId: () => "123",
      store: fixture.store,
    });
    await expect(
      auth.callback(
        new Request(callback, {
          headers: { cookie: "streambot_oauth_state=wrong" },
        }),
      ),
    ).rejects.toThrow("Sign-in expired");
  });

  test("references expire and cannot cross sessions; sessions expire and logout invalidates them", async () => {
    fixture = webFixture();
    const references = new Selections<string>(100);
    const token = references.add("alice", "source", 1000);
    expect(references.get("alice", token, 1050)).toBe("source");
    expect(() => references.get("bob", token, 1050)).toThrow("expired");
    expect(() => references.get("alice", token, 1100)).toThrow("expired");
    const created = fixture.store.create(
      { userId: USER, username: "tester", guildIds: [GUILD] },
      0,
    );
    expect(
      fixture.store.read(created.token, 8 * 24 * 60 * 60 * 1000),
    ).toBeNull();
    const logout = new Request(
      "http://127.0.0.1:8080/api/auth/logout",
      fixture.command({ action: "stop" }),
    );
    expect(await status(logout)).toBe(302);
    expect(await status(fixture.command({ action: "stop" }))).toBe(401);
  });

  test("web bootstrap is absent by default and invalid or incomplete configuration fails", () => {
    fixture = webFixture();
    const base = {
      BOT_TOKEN: "fixture",
      USER_TOKENS: "fixture",
      VIDEOS_DIR: "/videos",
    };
    expect(loadConfig(base).web).toBeUndefined();
    expect(() =>
      loadConfig({ ...base, WEB_PUBLIC_ORIGIN: "https://streambot.sjer.red" }),
    ).toThrow();
    expect(() =>
      loadConfig({
        ...base,
        WEB_PUBLIC_ORIGIN: "http://streambot.sjer.red",
        DISCORD_CLIENT_SECRET: "fixture",
      }),
    ).toThrow();
    expect(
      loadConfig({
        ...base,
        WEB_PUBLIC_ORIGIN: "https://streambot.sjer.red",
        DISCORD_CLIENT_SECRET: "fixture",
      }).web?.port,
    ).toBe(8080);
  });
});
