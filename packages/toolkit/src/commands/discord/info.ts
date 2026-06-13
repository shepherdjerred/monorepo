import { daemonRequest } from "#lib/discord/client.ts";
import {
  ChannelsResponseSchema,
  GuildsResponseSchema,
} from "#lib/discord/ipc.ts";
import { renderChannels, renderGuilds } from "#lib/discord/render.ts";

export async function guildsCommand(options: { json: boolean }): Promise<void> {
  const result = await daemonRequest(GuildsResponseSchema, "/guilds");
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderGuilds(result));
}

export async function channelsCommand(
  guildId: string,
  options: { json: boolean },
): Promise<void> {
  const result = await daemonRequest(
    ChannelsResponseSchema,
    `/channels?guildId=${encodeURIComponent(guildId)}`,
  );
  if (options.json) {
    console.log(JSON.stringify(result.channels, null, 2));
    return;
  }
  console.log(renderChannels(result));
}
