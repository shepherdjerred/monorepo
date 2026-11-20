import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import { MusicBrainzProvider } from "@shepherdjerred/streambot/music/musicbrainz-provider.ts";
import { createMusicSearchProviders } from "@shepherdjerred/streambot/music/search-instrumentation.ts";
import { replayProvider } from "#youtube-music-fixture";

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
      /** The value the default registry reads, as the Flipt flag would answer. */
      setSearchProvider: (value: string) => {
        provider = value;
      },
    },
  };
}
