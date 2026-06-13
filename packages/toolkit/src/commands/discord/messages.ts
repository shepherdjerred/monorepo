import { daemonRequest } from "#lib/discord/client.ts";
import {
  ReadResponseSchema,
  SendResponseSchema,
  WaitResponseSchema,
  type IdentityKind,
} from "#lib/discord/ipc.ts";
import { renderMessage, renderMessages } from "#lib/discord/render.ts";

export async function sendCommand(
  channelId: string,
  content: string,
  options: { as: IdentityKind | undefined; json: boolean },
): Promise<void> {
  const result = await daemonRequest(SendResponseSchema, "/send", {
    channelId,
    content,
    as: options.as,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Sent as ${result.as} (message id ${result.messageId}).`);
}

export async function readCommand(
  channelId: string,
  options: { limit: number; json: boolean },
): Promise<void> {
  const result = await daemonRequest(ReadResponseSchema, "/read", {
    channelId,
    limit: options.limit,
  });
  if (options.json) {
    console.log(JSON.stringify(result.messages, null, 2));
    return;
  }
  console.log(renderMessages(result.messages));
}

export async function waitCommand(
  channelId: string,
  options: {
    fromUserId: string | undefined;
    contains: string | undefined;
    timeoutSeconds: number;
    json: boolean;
  },
): Promise<void> {
  const result = await daemonRequest(WaitResponseSchema, "/wait", {
    channelId,
    fromUserId: options.fromUserId,
    contains: options.contains,
    timeoutSeconds: options.timeoutSeconds,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    if (result.timedOut) {
      process.exitCode = 1;
    }
    return;
  }
  if (result.message === null) {
    console.error(
      `No matching message within ${String(options.timeoutSeconds)}s.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(renderMessage(result.message));
}
