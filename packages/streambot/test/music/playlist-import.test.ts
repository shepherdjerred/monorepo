import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { z } from "zod";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { runPlaylistImportCommand } from "@shepherdjerred/streambot/commands/music-command-handler.ts";
import type { CommandBotDeps } from "@shepherdjerred/streambot/discord/commands/command-bot-deps.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands/commands.ts";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import {
  isImportablePlaylistUrl,
  PlaylistPageSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import {
  disambiguatePlaylistName,
  importExternalPlaylist,
} from "@shepherdjerred/streambot/music/playlist-import.ts";
import {
  MusicService,
  musicSource,
} from "@shepherdjerred/streambot/music/service.ts";
import { SpotifyMetadata } from "@shepherdjerred/streambot/music/spotify.ts";
import {
  buildPlaylistMetadataArgs,
  expandPlaylistWithMetadata,
} from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { ErrorSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { fixtureMusic, SONG } from "#music-fixture";
import { GUILD, OTHER, USER, webFixture } from "#web-fixture";

const ALBUM_COVER =
  "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273baf89eb11ec7c657805d2da0";

const tempDirs: string[] = [];
let activeFixture: ReturnType<typeof webFixture> | undefined;
let activeHistory: MediaHistoryStore | undefined;

afterEach(async () => {
  activeFixture?.playback.deps.music?.loads.close();
  activeFixture?.close();
  activeHistory?.close();
  activeFixture = undefined;
  activeHistory = undefined;
  await shutdownFeatureFlags();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true });
  }
});

function spotifyHtmlResponse(
  type: "album" | "playlist",
  title: string,
  trackCount = 2,
): SpotifyMetadata {
  const trackList = Array.from({ length: trackCount }, (_, index) => ({
    uri: `spotify:track:5nTtCOCds6I0PHMNtqela${String(index)}`,
    title: index === 0 ? "Get Lucky" : `Instant Crush ${String(index)}`,
    subtitle: "Daft Punk",
    duration: 369_000,
  }));
  const entity = {
    type,
    name: title,
    uri: `spotify:${type}:37i9dQZEVXbMDoHDwVN2t`,
    coverArt: { sources: [{ url: ALBUM_COVER, width: 300 }] },
    trackList,
  };
  const html =
    '<html><body><script id="__NEXT_DATA__">' +
    JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) +
    "</script></body></html>";
  return new SpotifyMetadata(
    Object.assign(() => Promise.resolve(new Response(html)), {
      preconnect: fetch.preconnect,
    }),
  );
}

function mutatePlaylist(
  f: ReturnType<typeof webFixture>,
  payload: Record<string, unknown>,
) {
  const request = f.command({ action: "volume", percent: 100 });
  return f.handler(
    new Request("http://127.0.0.1:8080/api/playlists", {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ ...payload, guildId: GUILD }),
    }),
  );
}

async function parseJson<T>(
  responsePromise: Promise<Response>,
  schema: z.ZodType<T>,
): Promise<{ status: number; body: T }> {
  const response = await responsePromise;
  return { status: response.status, body: schema.parse(await response.json()) };
}

describe("playlist import service and yt-dlp metadata expansion", () => {
  test("buildPlaylistMetadataArgs includes --ignore-config and playlist_title print format", () => {
    expect(
      buildPlaylistMetadataArgs(
        "https://www.youtube.com/playlist?list=PLfixture",
      ),
    ).toEqual([
      "--ignore-config",
      "--flat-playlist",
      "--no-warnings",
      "--print",
      "%(playlist_title)s\t%(url)s\t%(title)s",
      "https://www.youtube.com/playlist?list=PLfixture",
    ]);
  });

  test("expandPlaylistWithMetadata extracts title, keeps >100 items, and drops adult-blocked entries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "streambot-import-ytdlp-"));
    tempDirs.push(dir);
    const executable = path.join(dir, "ytdlp-fixture");
    await Bun.write(
      executable,
      "#!" +
        process.execPath +
        "\n" +
        [
          String.raw`await Bun.write(Bun.stdout, 'NA\thttps://pornhub.com/view_video.php?viewkey=1\tBlocked URL\n');`,
          String.raw`await Bun.write(Bun.stdout, 'Late Night Sessions\thttps://www.youtube.com/watch?v=00000000000\tnsfw mirror blocked title\n');`,
          String.raw`await Bun.write(Bun.stdout, 'NA\thttps://www.youtube.com/watch?v=00000000001\tOpening Track\n');`,
          "for (let i = 2; i <= 150; i += 1) {",
          "  const id = String(i).padStart(11, '0');",
          String.raw`  await Bun.write(Bun.stdout, 'Late Night Sessions\thttps://www.youtube.com/watch?v=' + id + '\tTrack ' + String(i) + '\n');`,
          "}",
        ].join("\n"),
    );
    await chmod(executable, 0o755);
    const config = loadConfig({
      BOT_TOKEN: "fixture",
      USER_TOKENS: "fixture",
      VIDEOS_DIR: "/tmp",
      YT_DLP_PATH: executable,
    });
    const metadata = await expandPlaylistWithMetadata(
      config,
      "https://www.youtube.com/playlist?list=PLfixture",
      AbortSignal.timeout(10_000),
    );
    expect(metadata.title).toBe("Late Night Sessions");
    expect(metadata.items).toHaveLength(150);
    expect(metadata.items[0]?.title).toBe("Opening Track");
    expect(metadata.items[149]?.title).toBe("Track 150");
  });

  test("Spotify album and playlist imports preserve tracks, album cover art, and ~100-track warning", async () => {
    const albumImported = await importExternalPlaylist(
      "https://open.spotify.com/album/37i9dQZEVXbMDoHDwVN2t?si=abc",
      { spotify: spotifyHtmlResponse("album", "Random Access Memories", 2) },
      AbortSignal.timeout(2000),
    );
    expect(albumImported.provider).toBe("spotify");
    expect(albumImported.title).toBe("Random Access Memories");
    expect(albumImported.items).toHaveLength(2);
    expect(albumImported.items[0]?.title).toBe("Daft Punk — Get Lucky");
    expect(albumImported.items[0]?.source.music?.artworkUrl).toBe(ALBUM_COVER);
    expect(albumImported.warning).toContain("up to 100 tracks");

    const playlistImported = await importExternalPlaylist(
      "<https://open.spotify.com/intl-en/playlist/37i9dQZEVXbMDoHDwVN2t>",
      { spotify: spotifyHtmlResponse("playlist", "Synthwave Focus", 2) },
      AbortSignal.timeout(2000),
    );
    expect(playlistImported.title).toBe("Synthwave Focus");
    expect(playlistImported.items[0]?.source.music?.artworkUrl).toBeUndefined();
    expect(playlistImported.warning).toContain("up to 100 tracks");
  });

  test("rejects unsupported links and empty external playlists with typed MusicError codes", async () => {
    await expect(
      importExternalPlaylist(
        "https://www.youtube.com/watch?v=QrR_gm6RqCo",
        { spotify: spotifyHtmlResponse("playlist", "Unused", 1) },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ status: 400, code: "playlist_import_link" });

    await expect(
      importExternalPlaylist(
        "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2t",
        {
          spotify: {
            load: () =>
              Promise.resolve({
                title: "Empty",
                tracks: [],
                complete: null,
                warning: "",
              }),
          },
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ status: 422, code: "playlist_empty" });

    await expect(
      importExternalPlaylist(
        "https://www.youtube.com/playlist?list=PLempty",
        {
          spotify: spotifyHtmlResponse("playlist", "Unused", 1),
          expandPlaylistWithMetadata: () =>
            Promise.resolve({ title: "Empty YT", items: [] }),
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ status: 422, code: "playlist_empty" });
  });

  test("disambiguatePlaylistName and isImportablePlaylistUrl handle collisions, truncation, and link forms", () => {
    expect(
      disambiguatePlaylistName(
        ["Evening Mix", "Evening Mix (2)"],
        "Evening Mix",
      ),
    ).toBe("Evening Mix (3)");
    const longBase = "A".repeat(120);
    const first = disambiguatePlaylistName([], longBase);
    expect(first).toHaveLength(100);
    const second = disambiguatePlaylistName([first], longBase);
    expect(second).toHaveLength(100);
    expect(second.endsWith(" (2)")).toBe(true);

    expect(
      isImportablePlaylistUrl(
        "https://open.spotify.com/intl-fr/playlist/37i9dQZEVXbMDoHDwVN2t",
      ),
    ).toBe(true);
    expect(
      isImportablePlaylistUrl(
        "https://open.spotify.com/album/37i9dQZEVXbMDoHDwVN2t",
      ),
    ).toBe(true);
    expect(
      isImportablePlaylistUrl("https://www.youtube.com/playlist?list=PL123"),
    ).toBe(true);
    expect(
      isImportablePlaylistUrl("https://www.youtube.com/watch?v=abc&list=PL123"),
    ).toBe(true);
    expect(isImportablePlaylistUrl("https://www.youtube.com/watch?v=abc")).toBe(
      false,
    );
    expect(
      isImportablePlaylistUrl("https://open.spotify.com/episode/abc123"),
    ).toBe(false);
  });
});

describe("web /api/playlists import and permissions", () => {
  test("imports Spotify and YouTube playlists without a voice channel, appends, and enforces owner/revision/spotify gates", async () => {
    activeHistory = new MediaHistoryStore(":memory:");
    const baseMusic = fixtureMusic();
    const spotify = spotifyHtmlResponse("album", "Discovery", 2);
    const loadSpy = vi.spyOn(spotify, "load");
    const expandSpy = vi.fn(() =>
      Promise.resolve({
        title: "Tiny Desk Favorites",
        items: Array.from({ length: 120 }, (_, index) => ({
          title: `Tiny Desk #${String(index + 1)}`,
          url: `https://www.youtube.com/watch?v=${String(index).padStart(11, "0")}`,
        })),
      }),
    );
    const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
      history: activeHistory,
      music: new MusicService(baseMusic.catalog, spotify, () =>
        Promise.resolve([]),
      ),
      musicEnabled: true,
      expandPlaylistWithMetadata: expandSpy,
    });
    activeFixture = f;
    // User is NOT in any Discord voice channel.
    f.setChannel(null);

    const createdSpotify = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        url: "https://open.spotify.com/album/37i9dQZEVXbMDoHDwVN2t",
      }),
      PlaylistPageSchema,
    );
    expect(createdSpotify.status).toBe(200);
    expect(createdSpotify.body.name).toBe("Discovery");
    expect(createdSpotify.body.count).toBe(2);
    expect(createdSpotify.body.cover?.artworkUrl).toBe(ALBUM_COVER);
    expect(createdSpotify.body.notice).toBe(
      "Imported 2 item(s). Spotify exposes public metadata only; collections may be incomplete (up to 100 tracks).",
    );
    expect(f.allocations()).toBe(0);

    // Importing again without an explicit name disambiguates; explicit collision returns 409.
    const secondAuto = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        url: "https://open.spotify.com/album/37i9dQZEVXbMDoHDwVN2t",
      }),
      PlaylistPageSchema,
    );
    expect(secondAuto.body.name).toBe("Discovery (2)");
    const explicitCollision = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        url: "https://open.spotify.com/album/37i9dQZEVXbMDoHDwVN2t",
        name: "Discovery",
      }),
      ErrorSchema,
    );
    expect(explicitCollision.status).toBe(409);
    expect(explicitCollision.body.code).toBe("playlist_name");

    // Append 120 YouTube playlist items to the first playlist.
    const appended = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        id: createdSpotify.body.id,
        revision: createdSpotify.body.revision,
        url: "https://www.youtube.com/playlist?list=PLtinydesk",
      }),
      PlaylistPageSchema,
    );
    expect(appended.status).toBe(200);
    expect(appended.body.revision).toBe(1);
    expect(appended.body.count).toBe(122);
    expect(appended.body.notice).toBe("Imported 120 item(s).");

    // Stale revision fails with 409 before hitting external providers.
    loadSpy.mockClear();
    expandSpy.mockClear();
    const stale = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        id: createdSpotify.body.id,
        revision: 0,
        url: "https://www.youtube.com/playlist?list=PLtinydesk",
      }),
      ErrorSchema,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("playlist_changed");
    expect(expandSpy).not.toHaveBeenCalled();

    // Non-owner cannot append to a shared playlist (403).
    const otherShared = activeHistory.playlists.create(
      { userId: OTHER, guildId: GUILD },
      "Shared by Casey",
      [{ title: SONG.title, source: musicSource(SONG) }],
    );
    const published = activeHistory.playlists.edit(
      otherShared.id,
      { userId: OTHER, guildId: GUILD },
      otherShared.revision,
      (playlist) => {
        playlist.guild_id = GUILD;
      },
    );
    const notOwner = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        id: published.id,
        revision: published.revision,
        url: "https://www.youtube.com/playlist?list=PLtinydesk",
      }),
      ErrorSchema,
    );
    expect(notOwner.status).toBe(403);
    expect(notOwner.body.code).toBe("playlist_owner");
    expect(expandSpy).not.toHaveBeenCalled();

    // Disabling spotifyLinks blocks Spotify import with 403 while YouTube playlist import still works.
    vi.spyOn(f.playback.deps.featureGate, "spotifyLinks").mockResolvedValue(
      false,
    );
    const spotifyDenied = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        url: "https://open.spotify.com/album/37i9dQZEVXbMDoHDwVN2t",
      }),
      ErrorSchema,
    );
    expect(spotifyDenied.status).toBe(403);
    expect(spotifyDenied.body.code).toBe("feature_disabled");
    expect(loadSpy).not.toHaveBeenCalled();

    const youtubeAllowed = await parseJson(
      mutatePlaylist(f, {
        action: "import",
        url: "https://www.youtube.com/playlist?list=PLtinydesk",
      }),
      PlaylistPageSchema,
    );
    expect(youtubeAllowed.status).toBe(200);
    expect(youtubeAllowed.body.count).toBe(120);
  });
});

describe("Discord /music playlist import command", () => {
  test("registers /music playlist import and imports without requiring a voice channel", async () => {
    const musicCmd = commandJson.find((cmd) => cmd.name === "music");
    const playlistGroup = musicCmd?.options?.find(
      (opt) => opt.name === "playlist",
    );
    const importSub =
      playlistGroup !== undefined && "options" in playlistGroup
        ? playlistGroup.options?.find((opt) => opt.name === "import")
        : undefined;
    expect(importSub).toMatchObject({
      name: "import",
      options: [
        expect.objectContaining({ name: "url", required: true }),
        expect.objectContaining({ name: "name" }),
      ],
    });

    await initFeatureFlags({
      environment: {
        FEATURE_FLAGS_MODE: "static",
        FEATURE_FLAGS_STATIC_OVERRIDES: '{"streambot-web-ui-enabled":true}',
      },
    });
    activeHistory = new MediaHistoryStore(":memory:");
    const baseMusic = fixtureMusic();
    const spotify = spotifyHtmlResponse("playlist", "Roadtrip Anthems", 3);
    let spotifyEnabled = true;
    const deps: CommandBotDeps = {
      config: loadConfig({
        BOT_TOKEN: "fixture",
        USER_TOKENS: "fixture",
        VIDEOS_DIR: "/videos",
        WEB_PUBLIC_ORIGIN: "http://127.0.0.1:5188",
        DISCORD_CLIENT_SECRET: "fixture-only",
      }),
      getSessions: () => {
        throw new Error("Playlist import must not touch voice sessions");
      },
      library: () => [],
      expandPlaylist: () => Promise.resolve([]),
      expandPlaylistWithMetadata: () =>
        Promise.resolve({
          title: "YouTube Mix",
          items: [
            { title: "Track 1", url: "https://www.youtube.com/watch?v=1" },
          ],
        }),
      listSources: () => Promise.resolve([]),
      resolvePlaySource: () => Promise.reject(new Error("Unused")),
      history: activeHistory,
      music: new MusicService(baseMusic.catalog, spotify, () =>
        Promise.resolve([]),
      ),
      featureGate: {
        playlists: () => Promise.resolve(true),
        spotifyLinks: () => Promise.resolve(spotifyEnabled),
        assistantV2: () => Promise.resolve(false),
        history: () => Promise.resolve(true),
        musicOverVoice: () => Promise.resolve(true),
      },
    };
    const deferReply = vi.fn(() => Promise.resolve());
    const editReply = vi.fn(() => Promise.resolve());
    await runPlaylistImportCommand(
      {
        guildId: GUILD,
        channelId: "100000000000000030",
        user: { id: USER },
        guild: { voiceStates: { cache: new Map() } },
        options: {
          getString: (name) =>
            name === "url"
              ? "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2t"
              : null,
        },
        deferReply,
        editReply,
      },
      deps,
    );
    expect(deferReply).toHaveBeenCalledOnce();
    const saved = activeHistory.playlists.list(
      { userId: USER, guildId: GUILD },
      "mine",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("Roadtrip Anthems");
    expect(saved[0]?.count).toBe(3);
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(
          /Saved private playlist \*\*Roadtrip Anthems\*\*\. Imported 3 item\(s\)\. Spotify exposes public metadata only; collections may be incomplete \(up to 100 tracks\)\.\n\[Open playlists\]\(http:\/\/127\.0\.0\.1:5188\/playlists\?guild=100000000000000010&playlist=/u,
        ),
      }),
    );

    // Enforces spotifyLinks gate before deferring reply.
    spotifyEnabled = false;
    deferReply.mockClear();
    await expect(
      runPlaylistImportCommand(
        {
          guildId: GUILD,
          channelId: "100000000000000030",
          user: { id: USER },
          guild: null,
          options: {
            getString: (name) =>
              name === "url"
                ? "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2t"
                : null,
          },
          deferReply,
          editReply,
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 403, code: "music_disabled" });
    expect(deferReply).not.toHaveBeenCalled();
  });
});
