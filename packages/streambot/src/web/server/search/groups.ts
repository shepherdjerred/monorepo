import { spotifyLink } from "@shepherdjerred/streambot/music/spotify.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import type { Row } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { Group } from "./observe.ts";
import { GROUP_LIMIT, type SearchContext, type SearchDeps } from "./context.ts";
import {
  bothActions,
  historyActions,
  historyLabel,
  joined,
  pastedUrl,
} from "./rows.ts";

const SPORTS_LABELS = {
  streameast: "StreamEast",
  tvsportslive: "TV Sports Live",
  lolesports: "LoL Esports",
} as const;

/** Files in the media library; they only play as video. */
export function libraryGroup(
  deps: SearchDeps,
  context: SearchContext,
  query: string,
): Group {
  if (query === "" || pastedUrl(query) !== null) return { items: [] };
  const files = deps.playback.deps.catalog.searchFiles(
    query,
    context.owner,
    context.guildId,
    GROUP_LIMIT,
  );
  return {
    items: files.map((file): Row => ({
      id: file.id,
      kind: "library",
      title: file.title,
      subtitle: joined([file.library, file.year?.toString()]),
      ...(file.artworkUrl === undefined ? {} : { artworkUrl: file.artworkUrl }),
      actions: ["watch"],
    })),
  };
}

/** A pasted link is its own selection: playlists and Spotify links expand when it is played. */
async function linkRow(
  deps: SearchDeps,
  context: SearchContext,
  url: URL,
): Promise<Row> {
  const spotify = spotifyLink(url.href) !== null;
  const features = await deps.music.features(context.session, context.guildId);
  const allowed = !spotify || features.spotify;
  const sports = sportsEventForSource(url.href) !== null;
  const path = url.pathname === "/" ? "" : url.pathname;
  return {
    id: url.href,
    kind: "link",
    title: (url.hostname + path).slice(0, 120),
    subtitle: "Link",
    // Live sports can only be watched; the play command refuses Listen for them.
    actions: sports
      ? ["watch"]
      : allowed
        ? bothActions(spotify ? "listen" : "watch", context.listen)
        : [],
  };
}

/** YouTube discovery, or one link row when the query is a pasted URL. */
export async function videosGroup(
  deps: SearchDeps,
  context: SearchContext,
  query: string,
): Promise<Group> {
  const pasted = pastedUrl(query);
  if (pasted === "malformed" || query === "") return { items: [] };
  if (pasted !== null) return { items: [await linkRow(deps, context, pasted)] };
  const results = await deps.playback.deps.catalog.search(
    new URLSearchParams({ query, source: "youtube" }),
    context.scope,
    context.owner,
    context.signal,
  );
  return {
    items: results
      .filter((result) => result.provider === "youtube")
      .slice(0, GROUP_LIMIT)
      .map((result): Row => ({
        id: result.id,
        kind: "video",
        title: result.title,
        ...(result.channel === undefined ? {} : { subtitle: result.channel }),
        ...(result.durationSeconds === undefined
          ? {}
          : { durationSeconds: result.durationSeconds }),
        ...(result.artworkUrl === undefined
          ? {}
          : { artworkUrl: result.artworkUrl }),
        actions: bothActions("watch", context.listen),
      })),
  };
}

/** Live and upcoming sports listings. */
export async function liveGroup(
  deps: SearchDeps,
  context: SearchContext,
  query: string,
): Promise<Group> {
  if (pastedUrl(query) !== null) return { items: [] };
  const lolGate = deps.playback.deps.featureGate.lolEsports;
  const lol = (await lolGate?.(context.scope)) === true;
  const events = await deps.playback.deps.catalog.sports.browse(
    new URLSearchParams({ query, provider: "auto" }),
    context.owner,
    context.signal,
    { lol, scheduling: false },
  );
  return {
    items: events.slice(0, GROUP_LIMIT).map((event): Row => ({
      id: event.id,
      kind: "live",
      title: event.title,
      subtitle: SPORTS_LABELS[event.provider],
      status: event.status,
      ...(event.startsAt === null ? {} : { startsAt: event.startsAt }),
      ...(event.sportsArtwork === undefined
        ? {}
        : { sportsArtwork: event.sportsArtwork }),
      // Upcoming and Pro-only events are refused when played, so they offer nothing to click.
      actions:
        event.status === "scheduled" || event.proOnly === true ? [] : ["watch"],
    })),
  };
}

/** The viewer's own playback history. */
export async function historyGroup(
  deps: SearchDeps,
  context: SearchContext,
  query: string,
): Promise<Group> {
  if (pastedUrl(query) !== null) return { items: [] };
  const { playback } = deps;
  const { session, guildId } = context;
  const page = await playback.history.browseWithSources({
    params: new URLSearchParams({ guildId, query }),
    userId: session.identity.userId,
    owner: context.owner,
    catalog: playback.deps.catalog,
    sportsEnabled: await playback.sportsEnabled(session, guildId),
    requester: (guild, user) => playback.requesterName(session, guild, user),
    signal: context.signal,
  });
  return {
    items: page.items.slice(0, GROUP_LIMIT).map(({ item, source }): Row => ({
      id: item.id,
      kind: "history",
      title: item.title,
      subtitle: historyLabel(item.provider),
      ...(item.durationSeconds === null
        ? {}
        : { durationSeconds: item.durationSeconds }),
      ...(item.artworkUrl === undefined ? {} : { artworkUrl: item.artworkUrl }),
      ...(item.sportsArtwork === undefined
        ? {}
        : { sportsArtwork: item.sportsArtwork }),
      ...historyActions({
        provider: item.provider,
        source,
        replayAvailable: item.replayAvailable,
        listenAllowed: context.listen,
      }),
    })),
  };
}
