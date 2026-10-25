import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { webUiEnabled } from "@shepherdjerred/streambot/config/media-features.ts";
import { randomTip } from "./tips.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";

export async function webRemoteUrl(
  config: Pick<Config, "web">,
  guildId: string | undefined,
  userId: string,
  playbackChannel?: number,
): Promise<string | undefined> {
  if (
    guildId === undefined ||
    config.web === undefined ||
    !(await webUiEnabled(guildId, userId))
  )
    return undefined;
  const url = new URL("/plex", config.web.publicOrigin);
  url.searchParams.set("guild", guildId);
  if (playbackChannel !== undefined)
    url.searchParams.set("channel", String(playbackChannel));
  return url.href;
}

export async function playTip(
  deps: {
    config: Config;
    guildId?: string;
    playbackChannel?: number;
    routePlayback?: PlaybackCommandServiceDeps["routePlayback"];
  },
  userId: string,
) {
  const url = await webPageUrl(
    deps.config,
    {
      guildId: deps.guildId,
      userId,
      playbackChannel:
        deps.routePlayback === undefined ? deps.playbackChannel : undefined,
    },
    deps.playbackChannel === 1 ? "/music" : "/plex",
  );
  return (
    randomTip(deps.playbackChannel) +
    (url === undefined ? "" : `\n\n[Open Streambot](${url})`)
  );
}

export async function webPageUrl(
  config: Pick<Config, "web">,
  scope: {
    guildId: string | undefined;
    userId: string;
    playbackChannel?: number | undefined;
  },
  page: "/plex" | "/music" | "/playlists",
) {
  const base = await webRemoteUrl(
    config,
    scope.guildId,
    scope.userId,
    scope.playbackChannel,
  );
  if (base === undefined) return;
  const url = new URL(base);
  url.pathname = page;
  return url.href;
}
