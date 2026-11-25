import { vi } from "vitest";
import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import { MusicBrainzProvider } from "@shepherdjerred/streambot/music/musicbrainz-provider.ts";
import { createMusicSearchProviders } from "@shepherdjerred/streambot/music/search-instrumentation.ts";
import { replayProvider } from "#youtube-music-fixture";
import { BrowsePageSchema } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";

/** The default providers: recorded YouTube Music responses beside the music fixture MusicBrainz. */
function musicSearchOption(
  music: MusicService | undefined,
  selected: () => Promise<string>,
) {
  return music === undefined
    ? {}
    : {
        musicSearch: createMusicSearchProviders(
          {
            "youtube-music": replayProvider(),
            musicbrainz: new MusicBrainzProvider(music.catalog),
          },
          selected,
        ),
      };
}

/**
 * The ids of the playlist loads `music` starts from now on, in order. The web answers a pasted
 * playlist before it finishes loading and does not hand out the load id, so tests observe it here.
 */
export function recordLoads(music: MusicService | undefined): string[] {
  if (music === undefined) throw new Error("Missing fixture music");
  const ids: string[] = [];
  const start = music.loads.start.bind(music.loads);
  vi.spyOn(music.loads, "start").mockImplementation((...args) => {
    const progress = start(...args);
    ids.push(progress.id);
    return progress;
  });
  return ids;
}

/**
 * The selection that plays a whole album of the fixture MusicBrainz catalog, as the album page
 * (`/api/music/v2/album`) hands it out. Leaves MusicBrainz as the selected search provider.
 */
export async function albumSelection(
  fixture: {
    handler: (request: Request) => Promise<Response>;
    cookie: string;
    setSearchProvider: (value: string) => void;
  },
  input: { album: string; guildId: string },
): Promise<string> {
  fixture.setSearchProvider("musicbrainz");
  const response = await fixture.handler(
    new Request(
      "http://127.0.0.1:8080/api/music/v2/album?" +
        new URLSearchParams({
          id: input.album,
          guildId: input.guildId,
        }).toString(),
      { headers: { cookie: fixture.cookie } },
    ),
  );
  const play = BrowsePageSchema.parse(await response.json()).play;
  if (play === undefined) throw new Error("The album page has no play");
  return play.id;
}

/** Gates the music search tests flip: music over voice, and the flag value that picks the provider. */
export function searchControls() {
  let listen = true;
  let provider = "youtube-music";
  return {
    listen: () => listen,
    /** The playback deps for these controls: recorded YouTube Music beside the fixture MusicBrainz. */
    deps: (music: MusicService | undefined) =>
      musicSearchOption(music, () => Promise.resolve(provider)),
    setters: {
      setMusicOverVoice: (value: boolean) => {
        listen = value;
      },
      /** The value the default registry reads, as the feature flag would answer. */
      setSearchProvider: (value: string) => {
        provider = value;
      },
    },
  };
}
