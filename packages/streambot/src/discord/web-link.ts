import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { webUiEnabled } from "@shepherdjerred/streambot/config/media-features.ts";
import { randomTip } from "./tips.ts";

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
  deps: { config: Config; guildId?: string; playbackChannel?: number },
  userId: string,
) {
  return randomTip(
    deps.playbackChannel,
    await webRemoteUrl(deps.config, deps.guildId, userId, deps.playbackChannel),
  );
}
