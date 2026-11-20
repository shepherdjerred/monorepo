import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import type { WebMusic } from "@shepherdjerred/streambot/web/server/music.ts";
import type { WebPlayback } from "@shepherdjerred/streambot/web/server/playback.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";

/** What every search request needs about its viewer and server, resolved once. */
export type SearchContext = {
  readonly session: WebSession;
  readonly guildId: string;
  readonly scope: DiscoveryScope;
  readonly owner: string;
  /** Music over voice is enabled, so `listen` may be offered. */
  readonly listen: boolean;
  readonly signal: AbortSignal;
};

/** Each group is small: the client renders a handful of rows and offers a browse page for more. */
export const GROUP_LIMIT = 20;
const REQUEST_DEADLINE_MS = 30_000;

export function requestSignal(request: Request): AbortSignal {
  return AbortSignal.any([
    request.signal,
    AbortSignal.timeout(REQUEST_DEADLINE_MS),
  ]);
}

export type SearchDeps = {
  readonly playback: WebPlayback;
  readonly music: WebMusic;
};

export async function searchContext(
  deps: SearchDeps,
  request: Request,
  session: WebSession,
  guildId: string,
): Promise<SearchContext> {
  await deps.playback.authorize(session, guildId);
  const channel = deps.playback.deps.bot.webVoiceChannel(
    GuildIdSchema.parse(guildId),
    session.identity.userId,
  );
  const scope = {
    guildId,
    userId: session.identity.userId,
    channelId: channel?.id ?? "web",
  };
  return {
    session,
    guildId,
    scope,
    owner: deps.music.owner(session, guildId),
    listen: await deps.playback.deps.featureGate.musicOverVoice(scope),
    signal: requestSignal(request),
  };
}
