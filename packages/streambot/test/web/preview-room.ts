/** Room state and switches for the local visual preview (`preview.ts`); never served in production. */
import { waitFor } from "xstate";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import type { MusicTrack } from "@shepherdjerred/streambot/music/contracts.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { LibraryArtworkProvider } from "@shepherdjerred/streambot/metadata/plex.ts";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import { SONG } from "#music-fixture";
import {
  CHANNEL,
  LIBRARY,
  OTHER,
  USER,
  type webFixture,
} from "./web-fixture.ts";
import type { createFixtureSlot } from "./web-fixture-slot.ts";

type Fixture = ReturnType<typeof webFixture>;
type Slot = ReturnType<typeof createFixtureSlot>;

/** The fixture library plus a title that matches the preview's music searches. */
export const PREVIEW_LIBRARY: LibraryEntry[] = [
  ...LIBRARY,
  {
    path: "/media/movies/daft-punk-unchained.mkv",
    relativePath: "daft-punk-unchained.mkv",
    library: "movies",
    title: "Daft Punk Unchained",
    year: 2015,
  },
];

function track(id: string, title: string, seconds: number): MusicTrack {
  return {
    ...SONG,
    id,
    title,
    durationSeconds: seconds,
    canonicalUrl: "https://musicbrainz.org/recording/" + id,
  };
}

/**
 * A Listening player (slot 1) with a song playing and two queued, and one more title queued
 * behind the Watching player's film, so both rail cards have something in every section.
 */
export async function seedPreviewRoom(
  ensureSlot: (slot: PlaybackChannelNumber) => Slot,
  watching: Slot,
): Promise<void> {
  const listening = ensureSlot(PlaybackChannelNumberSchema.parse(1));
  const songs = [
    SONG,
    track("2cGxRwrM-instant-crush", "Instant Crush", 337),
    track("0dEIca2n-giorgio", "Giorgio by Moroder", 544),
  ];
  for (const [index, song] of songs.entries())
    listening.actor.send({
      type: "ADD",
      source: musicSource(song),
      requesterId: index === 1 ? OTHER : USER,
      queuedAt: Date.now() - 60_000 + index,
    });
  await waitFor(listening.actor, (state) => state.matches("streaming"), {
    timeout: 2000,
  });
  watching.actor.send({
    type: "ADD",
    source: {
      kind: "file",
      path: "/media/movies/spirited-away.mkv",
      title: "Spirited Away",
    },
    requesterId: USER,
    queuedAt: Date.now(),
  });
}

const POSTER_TINTS = ["#2f4f46", "#3d5f8f", "#6b4f2f", "#5a3d6b", "#2f5a3d"];

/**
 * Offline stand-in for Plex artwork: a plain SVG poster named after the file, so the preview can
 * enable the Plex posters gate (which the Library titles view needs) without any network access.
 */
export const PREVIEW_PLEX_ARTWORK: LibraryArtworkProvider = {
  image: (path) => {
    const entry = PREVIEW_LIBRARY.find((candidate) => candidate.path === path);
    if (entry === undefined) return Promise.resolve(null);
    const name = (entry.series ?? entry.title)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;");
    const tint = POSTER_TINTS[name.length % POSTER_TINTS.length] ?? "#2f4f46";
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300">` +
      `<rect width="200" height="300" fill="${tint}"/>` +
      `<text x="100" y="160" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="15">${name}</text>` +
      `</svg>`;
    return Promise.resolve({
      bytes: new TextEncoder().encode(svg),
      contentType: "image/svg+xml",
    });
  },
};

/** Records spans in memory so API responses carry `x-trace-id`, as they do in production. */
export function startPreviewTracing(): void {
  new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  }).start();
}

/**
 * Preview-only switches for states that need Discord to change:
 * `/preview/voice?in=0|1` leaves or rejoins the voice channel, and `/preview/listen?enabled=0|1`
 * turns the Listen gate off so an open page's Listen buttons hit the server's `listen_disabled`.
 */
export function previewSwitch(fixture: Fixture, url: URL): Response | null {
  const on =
    url.searchParams.get(
      url.pathname === "/preview/voice" ? "in" : "enabled",
    ) !== "0";
  if (url.pathname === "/preview/voice") {
    fixture.setChannel(on ? { id: CHANNEL, name: "Movie night" } : null);
    return new Response(on ? "In Movie night\n" : "Not in a voice channel\n");
  }
  if (url.pathname === "/preview/listen") {
    fixture.setMusicOverVoice(on);
    return new Response(on ? "Listen enabled\n" : "Listen disabled\n");
  }
  return null;
}
