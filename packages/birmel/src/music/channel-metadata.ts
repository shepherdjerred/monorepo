import type { MessageCreateOptions } from "discord.js";
import { z } from "zod";

type SendableMessage = string | MessageCreateOptions;

export type ChannelMetadata = {
  send?: ((msg: SendableMessage) => Promise<unknown>) | undefined;
  id?: string | undefined;
};

const ChannelMetadataSchema = z
  .object({
    send: z.unknown().optional(),
    id: z.string().optional(),
  })
  .loose();

function wrapSendFunction(
  value: unknown,
  thisArg: unknown,
): ((msg: SendableMessage) => Promise<unknown>) | undefined {
  if (typeof value !== "function") {
    return undefined;
  }
  const fn = value;
  return (msg: SendableMessage): Promise<unknown> => {
    const result: unknown = Reflect.apply(fn, thisArg, [msg]);
    if (result instanceof Promise) {
      return result;
    }
    return Promise.resolve(result);
  };
}

export function getChannelMetadata(
  metadata: unknown,
): ChannelMetadata | undefined {
  const result = ChannelMetadataSchema.safeParse(metadata);
  if (!result.success) {
    return undefined;
  }
  return {
    send: wrapSendFunction(result.data.send, metadata),
    id: result.data.id,
  };
}
