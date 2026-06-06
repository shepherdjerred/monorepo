import type { APIEmbed, APIEmbedField } from "discord.js";
import type { MusicTrackInfo } from "./metadata.ts";
import { sumDurations } from "./metadata.ts";

const MUSIC_COLOR = 0x9b_59_b6;
const SUCCESS_COLOR = 0x2e_cc_71;
const WARNING_COLOR = 0xf1_c4_0f;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function trackLine(track: MusicTrackInfo, position?: number): string {
  const prefix = position == null ? "" : `**${String(position)}.** `;
  const title =
    track.url.length > 0
      ? `[${truncate(track.title, 80)}](${track.url})`
      : truncate(track.title, 80);
  return `${prefix}${title} \`${track.duration}\``;
}

function buildTrackFields(track: MusicTrackInfo): APIEmbedField[] {
  const fields: APIEmbedField[] = [
    { name: "Duration", value: track.duration, inline: true },
  ];
  if (track.source != null) {
    fields.push({ name: "Source", value: track.source, inline: true });
  }
  if (track.requestedBy != null) {
    fields.push({
      name: "Requested by",
      value: track.requestedBy,
      inline: true,
    });
  }
  return fields;
}

export function buildNowPlayingEmbed(
  track: MusicTrackInfo,
  progress?: string,
): APIEmbed {
  return {
    title: "Now Playing",
    description: trackLine(track),
    color: MUSIC_COLOR,
    fields: [
      ...buildTrackFields(track),
      ...(progress != null && progress.length > 0
        ? [{ name: "Progress", value: progress, inline: false }]
        : []),
    ],
    ...(track.coverUrl != null && { thumbnail: { url: track.coverUrl } }),
  };
}

export function buildQueueEmbed(input: {
  currentTrack: MusicTrackInfo | null;
  tracks: MusicTrackInfo[];
  totalTracks: number;
}): APIEmbed {
  const visibleTracks = input.tracks.slice(0, 10);
  const totalDuration = sumDurations(input.tracks);
  const fields: APIEmbedField[] = [];

  if (input.currentTrack != null) {
    fields.push({
      name: "Current",
      value: trackLine(input.currentTrack),
      inline: false,
    });
  }

  fields.push({
    name: "Up Next",
    value:
      visibleTracks.length === 0
        ? "Queue is empty."
        : visibleTracks
            .map((track, index) => trackLine(track, index + 1))
            .join("\n"),
    inline: false,
  });

  fields.push({
    name: "Queued",
    value: String(input.totalTracks),
    inline: true,
  });
  if (totalDuration != null) {
    fields.push({ name: "Total duration", value: totalDuration, inline: true });
  }

  return {
    title: "Music Queue",
    color: MUSIC_COLOR,
    fields,
    ...(input.currentTrack?.coverUrl != null && {
      thumbnail: { url: input.currentTrack.coverUrl },
    }),
  };
}

export function buildPlaylistEmbed(input: {
  name: string;
  tracks: MusicTrackInfo[];
}): APIEmbed {
  const visibleTracks = input.tracks.slice(0, 15);
  const totalDuration = sumDurations(input.tracks);
  const fields: APIEmbedField[] = [
    {
      name: "Tracks",
      value:
        visibleTracks.length === 0
          ? "Playlist is empty."
          : visibleTracks
              .map((track, index) => trackLine(track, index + 1))
              .join("\n"),
      inline: false,
    },
    { name: "Count", value: String(input.tracks.length), inline: true },
  ];
  if (totalDuration != null) {
    fields.push({ name: "Total duration", value: totalDuration, inline: true });
  }

  return {
    title: `Playlist: ${input.name}`,
    color: MUSIC_COLOR,
    fields,
    ...(input.tracks[0]?.coverUrl != null && {
      thumbnail: { url: input.tracks[0].coverUrl },
    }),
  };
}

export function buildPlaylistListEmbed(
  playlists: { name: string; trackCount: number }[],
): APIEmbed {
  return {
    title: "Playlists",
    color: MUSIC_COLOR,
    description:
      playlists.length === 0
        ? "No in-memory playlists exist for this server."
        : playlists
            .map(
              (playlist) =>
                `**${playlist.name}** - ${String(playlist.trackCount)} tracks`,
            )
            .join("\n"),
  };
}

export function buildRecentTracksEmbed(tracks: MusicTrackInfo[]): APIEmbed {
  return {
    title: "Recent Tracks",
    color: MUSIC_COLOR,
    description:
      tracks.length === 0
        ? "No recent tracks found."
        : tracks.map((track, index) => trackLine(track, index + 1)).join("\n"),
    ...(tracks[0]?.coverUrl != null && {
      thumbnail: { url: tracks[0].coverUrl },
    }),
  };
}

export function buildHelpEmbed(): APIEmbed {
  return {
    title: "Birmel Music",
    color: MUSIC_COLOR,
    description:
      "Ask naturally: play, pause, resume, skip, stop, seek, volume, loop, now playing, queue, shuffle, move, jump, recent tracks, replay, and temporary playlists.",
    fields: [
      {
        name: "Playback",
        value:
          "play a song or URL, pause, resume, skip, stop, seek to a time, set volume, set loop mode, show now playing",
        inline: false,
      },
      {
        name: "Queue",
        value:
          "show queue, add a song, remove a position, move positions, jump to a position, shuffle, clear, show summary",
        inline: false,
      },
      {
        name: "Playlists",
        value:
          "create, list, show, rename, delete, add songs, add current track, save queue, remove, move, clear, play shuffled",
        inline: false,
      },
    ],
  };
}

export function buildActionEmbed(input: {
  title: string;
  message: string;
  track?: MusicTrackInfo | undefined;
  warning?: boolean | undefined;
}): APIEmbed {
  return {
    title: input.title,
    description: input.message,
    color: input.warning === true ? WARNING_COLOR : SUCCESS_COLOR,
    ...(input.track?.coverUrl != null && {
      thumbnail: { url: input.track.coverUrl },
    }),
  };
}
