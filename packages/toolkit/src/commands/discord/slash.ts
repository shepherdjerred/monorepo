import { daemonRequest } from "#lib/discord/client.ts";
import { invokeSlashDirect } from "#lib/discord/direct-slash.ts";
import {
  DirectSlashResponseSchema,
  SlashResponseSchema,
} from "#lib/discord/ipc.ts";
import { renderMessage } from "#lib/discord/render.ts";

export async function slashCommand(params: {
  channelId: string;
  botId: string;
  command: string;
  args: string[];
  json: boolean;
  direct: boolean;
  waitForPublicResponse: boolean;
  publicResponseContains?: string | undefined;
  timeoutSeconds: number;
}): Promise<void> {
  if (params.direct) {
    const result = DirectSlashResponseSchema.parse(
      await invokeSlashDirect({
        token: requireUserToken(),
        channelId: params.channelId,
        botId: params.botId,
        command: params.command,
        args: params.args,
        waitForPublicResponse: params.waitForPublicResponse,
        publicResponseContains: params.publicResponseContains,
        timeoutSeconds: params.timeoutSeconds,
      }),
    );
    renderResult(result, params);
    return;
  }
  const result = await daemonRequest(SlashResponseSchema, "/slash", {
    channelId: params.channelId,
    botId: params.botId,
    command: params.command,
    args: params.args,
  });
  renderResult(result, params);
}

function renderResult(
  result:
    | ReturnType<typeof SlashResponseSchema.parse>
    | ReturnType<typeof DirectSlashResponseSchema.parse>,
  params: { json: boolean; command: string; botId: string },
): void {
  if (params.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Invoked /${params.command} on bot ${params.botId}.`);
  if (result.reply !== null) {
    console.log("\nReply:");
    console.log(renderMessage(result.reply));
  }
  if (DirectSlashResponseSchema.safeParse(result).success) {
    const directResult = DirectSlashResponseSchema.parse(result);
    if (directResult.publicResponse !== null) {
      console.log("\nPublic response:");
      console.log(renderMessage(directResult.publicResponse));
    } else if (directResult.publicResponseTimedOut) {
      console.log("\nNo matching public response arrived before the timeout.");
    }
  }
}

function requireUserToken(): string {
  const token = Bun.env["DISCORD_USER_TOKEN"];
  if (token == null || token.length === 0) {
    throw new Error("--direct requires DISCORD_USER_TOKEN");
  }
  return token;
}
