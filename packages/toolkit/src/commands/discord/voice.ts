import { daemonRequest } from "#lib/discord/client.ts";
import {
  VoiceJoinResponseSchema,
  VoiceLeaveResponseSchema,
  VoiceStatesResponseSchema,
} from "#lib/discord/ipc.ts";
import { renderVoiceStates } from "#lib/discord/render.ts";

export async function voiceJoinCommand(
  channelId: string,
  options: { json: boolean },
): Promise<void> {
  const result = await daemonRequest(VoiceJoinResponseSchema, "/voice/join", {
    channelId,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `Userbot joined voice channel ${result.channelId} (guild ${result.guildId}). Presence persists until 'toolkit discord voice leave' or daemon stop.`,
  );
}

export async function voiceLeaveCommand(options: {
  json: boolean;
}): Promise<void> {
  const result = await daemonRequest(
    VoiceLeaveResponseSchema,
    "/voice/leave",
    {},
  );
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.left ? "Left voice." : "Was not in voice.");
}

export async function voiceStatesCommand(
  guildId: string,
  options: { json: boolean },
): Promise<void> {
  const result = await daemonRequest(
    VoiceStatesResponseSchema,
    `/voice/states?guildId=${encodeURIComponent(guildId)}`,
  );
  if (options.json) {
    console.log(JSON.stringify(result.states, null, 2));
    return;
  }
  console.log(renderVoiceStates(result));
}
