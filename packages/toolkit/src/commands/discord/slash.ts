import { daemonRequest } from "#lib/discord/client.ts";
import { SlashResponseSchema } from "#lib/discord/ipc.ts";
import { renderMessage } from "#lib/discord/render.ts";

export async function slashCommand(params: {
  channelId: string;
  botId: string;
  command: string;
  args: string[];
  json: boolean;
}): Promise<void> {
  const result = await daemonRequest(SlashResponseSchema, "/slash", {
    channelId: params.channelId,
    botId: params.botId,
    command: params.command,
    args: params.args,
  });
  if (params.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Invoked /${params.command} on bot ${params.botId}.`);
  if (result.reply !== null) {
    console.log("\nReply:");
    console.log(renderMessage(result.reply));
  }
}
