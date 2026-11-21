import type { WebPlaybackDeps } from "@shepherdjerred/streambot/web/server/playback-deps.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { SnapshotOwner } from "./player-state.ts";

/** The music gates `/api/music/features` reports; the room reports the same three. */
export async function musicFeatureFlags(
  deps: WebPlaybackDeps,
  session: WebSession,
  guildId: string,
) {
  const scope = {
    guildId,
    userId: session.identity.userId,
    channelId: "web",
  };
  const gates = deps.featureGate;
  const [catalog, spotify, playlists] = await Promise.all([
    gates.musicCatalog?.(scope),
    gates.spotifyLinks?.(scope),
    gates.playlists?.(scope),
  ]);
  return {
    catalog: deps.music !== undefined && catalog === true,
    spotify: deps.music !== undefined && spotify === true,
    playlists: deps.commands.history !== undefined && playlists === true,
  };
}

/**
 * One consistent set of "may this viewer use X" answers, from the gates the old snapshot, the
 * music features endpoint and the command layer already enforce, so a client never has to click
 * to discover a 403. `channelId` is the viewer's voice channel, or null when they are in none.
 */
export async function roomCapabilities(input: {
  owner: SnapshotOwner;
  session: WebSession;
  guildId: string;
  channelId: string | null;
  plexPostersEnabled: (guildId: string, userId: string) => Promise<boolean>;
}): Promise<WebRoom["capabilities"]> {
  const { owner, session, guildId, channelId } = input;
  const gates = owner.deps.featureGate;
  const userId = session.identity.userId;
  const scope = { guildId, channelId: channelId ?? "web", userId };
  const [
    listen,
    sports,
    history,
    radio,
    tv,
    advanced,
    lol,
    music,
    plexPosters,
  ] = await Promise.all([
    gates.musicOverVoice(scope),
    owner.sportsEnabled(session, guildId),
    owner.historyEnabled(session, guildId),
    gates.radio?.(scope),
    gates.tv?.(scope),
    // Pause, resume and play-now are the assistant-v2 controls and need a voice channel to target.
    channelId === null ? false : gates.assistantV2(scope),
    gates.lolEsports?.(scope),
    musicFeatureFlags(owner.deps, session, guildId),
    input.plexPostersEnabled(guildId, userId),
  ]);
  return {
    listen,
    sports,
    history,
    radio: radio === true,
    tv: tv === true,
    pause: advanced,
    playNow: advanced,
    // The LoL browse endpoint refuses a viewer without live sports even when this gate is on.
    lolEsports: lol === true && sports,
    musicCatalog: music.catalog,
    playlists: music.playlists,
    spotifyLinks: music.spotify,
    plexPosters,
  };
}
