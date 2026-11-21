import { waitFor } from "xstate";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import { sessionRevision } from "@shepherdjerred/streambot/session/session-revision.ts";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { PersistedStation } from "@shepherdjerred/streambot/state/station-schema.ts";
import { CHANNEL, GUILD, OTHER, USER, type webFixture } from "./web-fixture.ts";
import { createFixtureSlot } from "./web-fixture-slot.ts";

type Fixture = ReturnType<typeof webFixture>;
type Slot = ReturnType<typeof createFixtureSlot>;

/**
 * Audio-only for `mode: "music"` sources, video for everything else. A track is titled
 * "Artists — Title" the way the production resolver labels music.
 */
export function resolveByMode(source: Source): ResolvedSource {
  return {
    title:
      source.music !== undefined || source.kind === "file"
        ? sourceLabel(source)
        : "Live",
    chapters: [],
    ffmpegInput: "fixture",
    mediaKind: source.mode === "music" ? "music" : "video",
    durationSeconds: 600,
  };
}

export const SONG_SOURCE: Source = {
  kind: "url",
  url: "https://www.youtube.com/watch?v=h5EofwRzit0",
  mode: "music",
  music: {
    provider: "musicbrainz",
    id: "room-test-song",
    title: "Room Test Song",
    artists: ["Room Test Artist"],
    durationSeconds: 240,
    canonicalUrl: "https://musicbrainz.org/recording/room-test-song",
  },
};

export const MOVIE_SOURCE: Source = {
  kind: "file",
  path: "/media/movies/arrival.mkv",
  title: "Arrival",
  mode: "video",
};

export const STATION: PersistedStation = {
  kind: "radio",
  scope: "room",
  ownerId: USER,
  recentIdentities: [],
  skippedIdentities: [],
};

/**
 * Replaces the fixture's single slot with a room of numbered slots, each backed by a real
 * playback machine, and reports every actor and station change to the fixture's room hub the way
 * the production session manager does.
 */
export function multiSlotRoom(fixture: Fixture) {
  fixture.enableNumbered(2);
  const slots = new Map<PlaybackChannelNumber, Slot>();
  const announce = () => {
    fixture.changes.notify({
      guildId: GUILD,
      channelId: CHANNEL,
      userId: null,
    });
  };
  const ensure = (number: PlaybackChannelNumber): Slot => {
    let slot = slots.get(number);
    if (slot === undefined) {
      slot = createFixtureSlot({
        guildId: GUILD,
        channelId: CHANNEL,
        resolveSource: resolveByMode,
      });
      slot.actor.subscribe(announce);
      slots.set(number, slot);
    }
    return slot;
  };
  const base = fixture.playback.deps.sessions;
  fixture.playback.deps.sessions = {
    ...base,
    getExisting: (guild, channel, number) =>
      guild !== GUILD || channel !== CHANNEL
        ? null
        : number === undefined
          ? base.getExisting(guild, channel)
          : (slots.get(number)?.handle ?? null),
    ensureForPlay: ({ playbackChannel }) =>
      playbackChannel === undefined
        ? fixture.handle
        : ensure(playbackChannel).handle,
    startStation: async ({ playbackChannel, station }) => {
      const slot = ensure(
        playbackChannel ?? PlaybackChannelNumberSchema.parse(1),
      );
      const added = await slot.startStation(station);
      announce();
      return { handle: slot.handle, added };
    },
    stopStation: ({ playbackChannel }) => {
      const stopped =
        playbackChannel === undefined
          ? null
          : (slots.get(playbackChannel)?.stopStation() ?? null);
      announce();
      return stopped;
    },
    revision: (_guild, _channel, number) => {
      if (number === undefined) return base.revision(_guild, _channel);
      const slot = slots.get(number);
      return slot === undefined ? null : sessionRevision(slot);
    },
  };
  return {
    slots,
    ensure,
    /** Queue `source` on `number` and wait until it is streaming. */
    play: async (number: number, source: Source) => {
      const slot = ensure(PlaybackChannelNumberSchema.parse(number));
      slot.actor.send({
        type: "ADD",
        source,
        requesterId: OTHER,
        queuedAt: Date.now(),
      });
      await waitFor(slot.actor, (state) => state.matches("streaming"), {
        timeout: 2000,
      });
      return slot;
    },
  };
}
