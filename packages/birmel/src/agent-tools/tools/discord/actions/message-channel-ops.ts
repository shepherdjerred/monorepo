import type { Client, SendableChannels } from "discord.js";
import {
  resolveSendableChannel,
  describeChannelResolutionFailure,
} from "@shepherdjerred/birmel/agent-tools/tools/discord/channel-resolver.ts";

/** The shape every Discord message action returns to the agent. */
export type MessageResult = {
  success: boolean;
  message: string;
  data?:
    | { messageId: string }
    | {
        messages: {
          id: string;
          authorId: string;
          authorName: string;
          isBot: boolean;
          content: string;
          createdAt: string;
        }[];
      };
};

export type ChannelOpResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

/**
 * Resolve a channel, confirm it can be written to, and run `body` against it.
 * Channel resolution failure is a reportable outcome rather than a throw, so
 * the agent sees why the action did not happen.
 */
export async function withSendableChannel<T>(
  client: Client,
  channelId: string,
  signal: AbortSignal,
  body: (channel: SendableChannels) => Promise<T>,
): Promise<ChannelOpResult<T>> {
  signal.throwIfAborted();
  const resolution = await resolveSendableChannel(client, channelId);
  signal.throwIfAborted();
  if (resolution.kind !== "ok") {
    return {
      ok: false,
      message: describeChannelResolutionFailure(resolution, channelId),
    };
  }
  const value = await body(resolution.channel);
  return { ok: true, value };
}
