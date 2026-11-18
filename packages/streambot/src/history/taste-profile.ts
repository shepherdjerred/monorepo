import type { Database } from "bun:sqlite";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  ingestGuildServerTaste,
  ingestUserTasteSet,
  type TasteAccumulator,
} from "./taste-profile-ingest.ts";
import { collectTasteQueueSignals } from "./taste-profile-signals.ts";

const ROOM_FALLBACK_MIN_ITEMS = 5;

export type MusicTasteProfileInput = {
  readonly listenerIds: readonly string[];
  readonly ownerId: string;
  readonly guildId: string;
  readonly scope: "room" | "mine" | "server";
  readonly excludeIdentities: ReadonlySet<string>;
};

export type FamiliarMusicCandidate = {
  readonly source: Source;
  readonly identity: string;
  readonly workKey: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly youtubeVideoId?: string;
  readonly thumbnailUrl?: string;
  readonly channel?: string;
  readonly durationSeconds?: number;
  readonly score: number;
};

export type MusicTasteProfile = {
  readonly familiarCandidates: readonly FamiliarMusicCandidate[];
  readonly topArtists: readonly string[];
  readonly topTracks: readonly string[];
  readonly skippedTitles: readonly string[];
  readonly recentQueries: readonly string[];
};

function positiveAvailableCount(
  entries: ReadonlyMap<string, TasteAccumulator>,
  excludeIdentities: ReadonlySet<string>,
): number {
  let count = 0;
  for (const entry of entries.values()) {
    if (entry.score > 0 && !excludeIdentities.has(entry.identity)) {
      count += 1;
    }
  }
  return count;
}

function populateEntriesByScope(
  database: Database,
  entries: Map<string, TasteAccumulator>,
  input: MusicTasteProfileInput,
  roomListeners: readonly string[],
): void {
  if (input.scope === "mine") {
    ingestUserTasteSet({
      database,
      entries,
      userIds: [input.ownerId],
      guildId: input.guildId,
      weightScale: 1,
      includeSharedGuildPlaylists: false,
    });
    return;
  }
  if (input.scope === "server") {
    ingestUserTasteSet({
      database,
      entries,
      userIds: [input.ownerId],
      guildId: input.guildId,
      weightScale: 1,
      includeSharedGuildPlaylists: true,
    });
    ingestGuildServerTaste({
      database,
      entries,
      guildId: input.guildId,
      weightScale: 1,
      skipUsers: new Set([input.ownerId]),
    });
    return;
  }

  ingestUserTasteSet({
    database,
    entries,
    userIds: roomListeners,
    guildId: input.guildId,
    weightScale: 1,
    includeSharedGuildPlaylists: false,
  });
  for (const entry of entries.values()) {
    if (entry.positiveListeners.size > 1) {
      entry.score += (entry.positiveListeners.size - 1) * 18;
    }
  }
  if (
    positiveAvailableCount(entries, input.excludeIdentities) >=
    ROOM_FALLBACK_MIN_ITEMS
  ) {
    return;
  }
  const seenUsers = new Set(roomListeners);
  if (!seenUsers.has(input.ownerId) && input.ownerId.trim().length > 0) {
    ingestUserTasteSet({
      database,
      entries,
      userIds: [input.ownerId],
      guildId: input.guildId,
      weightScale: 0.75,
      includeSharedGuildPlaylists: false,
    });
    seenUsers.add(input.ownerId);
  }
  ingestGuildServerTaste({
    database,
    entries,
    guildId: input.guildId,
    weightScale: 0.5,
    skipUsers: seenUsers,
  });
}

function toFamiliarCandidate(entry: TasteAccumulator): FamiliarMusicCandidate {
  return {
    source: entry.source,
    identity: entry.identity,
    workKey: entry.workKey,
    title: entry.title,
    artists: entry.artists,
    score: entry.score,
    ...(entry.youtubeVideoId === undefined
      ? {}
      : { youtubeVideoId: entry.youtubeVideoId }),
    ...(entry.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: entry.thumbnailUrl }),
    ...(entry.channel === undefined ? {} : { channel: entry.channel }),
    ...(entry.durationSeconds === undefined
      ? {}
      : { durationSeconds: entry.durationSeconds }),
  };
}

function buildFamiliarCandidates(
  rankedAll: readonly TasteAccumulator[],
  excludeIdentities: ReadonlySet<string>,
): FamiliarMusicCandidate[] {
  const seenWorkKeys = new Set<string>();
  const familiarCandidates: FamiliarMusicCandidate[] = [];
  for (const entry of rankedAll) {
    if (entry.score <= 0 || excludeIdentities.has(entry.identity)) continue;
    if (entry.workKey.length > 0 && seenWorkKeys.has(entry.workKey)) continue;
    if (entry.workKey.length > 0) seenWorkKeys.add(entry.workKey);
    familiarCandidates.push(toFamiliarCandidate(entry));
  }
  return familiarCandidates;
}

function rankArtistsAndSkips(rankedAll: readonly TasteAccumulator[]): {
  readonly topArtists: string[];
  readonly skippedSet: Set<string>;
} {
  const skippedSet = new Set<string>();
  const artistScores = new Map<string, { display: string; score: number }>();
  for (const entry of rankedAll) {
    if (entry.score <= 0) {
      if (entry.skippedCount > 0) skippedSet.add(entry.trackLabel);
      continue;
    }
    for (const artist of entry.artists) {
      const key = artist.toLowerCase();
      const current = artistScores.get(key);
      artistScores.set(key, {
        display: current?.display ?? artist,
        score: (current?.score ?? 0) + entry.score,
      });
    }
  }
  const topArtists = [...artistScores.values()]
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((item) => item.display);
  return { topArtists, skippedSet };
}

export function buildMusicTasteProfile(
  database: Database,
  input: MusicTasteProfileInput,
): MusicTasteProfile {
  const entries = new Map<string, TasteAccumulator>();
  const rawListeners =
    input.listenerIds.length > 0 ? input.listenerIds : [input.ownerId];
  const roomListeners = [
    ...new Set(rawListeners.filter((id) => id.trim().length > 0)),
  ];

  populateEntriesByScope(database, entries, input, roomListeners);

  const rankedAll = [...entries.values()].toSorted(
    (left, right) => right.score - left.score,
  );
  const { topArtists, skippedSet } = rankArtistsAndSkips(rankedAll);
  const recentQueries = collectTasteQueueSignals({
    database,
    guildId: input.guildId,
    scope: input.scope,
    targetUsers: input.scope === "mine" ? [input.ownerId] : roomListeners,
    skippedSet,
  });
  const topTracks = rankedAll
    .filter((entry) => entry.score > 0)
    .slice(0, 12)
    .map((entry) => entry.trackLabel);

  return {
    familiarCandidates: buildFamiliarCandidates(
      rankedAll,
      input.excludeIdentities,
    ),
    topArtists,
    topTracks,
    skippedTitles: [...skippedSet].slice(0, 15),
    recentQueries,
  };
}
