import { ApplicationFlags, GatewayIntentBits, REST, Routes } from "discord.js";
import { z } from "zod";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

export function messageContentAllowed(application: unknown): boolean {
  const data = z
    .object({
      flags: z.number().int().nonnegative().optional(),
      flags_new: z.string().regex(/^\d+$/u).optional(),
    })
    .refine(
      (value) => value.flags !== undefined || value.flags_new !== undefined,
    )
    .parse(application);
  const value = data.flags_new ?? data.flags;
  if (value === undefined)
    throw new Error("Discord application flags are missing");
  const flags = BigInt(value);
  return (
    (flags &
      BigInt(
        ApplicationFlags.GatewayMessageContent |
          ApplicationFlags.GatewayMessageContentLimited,
      )) !==
    0n
  );
}

/** Check Discord's granted capability before requesting a privileged gateway intent. */
export async function commandIntents(
  botToken: string,
): Promise<GatewayIntentBits[]> {
  const application: unknown = await new REST()
    .setToken(botToken)
    .get(Routes.currentApplication());
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ];
  if (messageContentAllowed(application))
    intents.push(GatewayIntentBits.MessageContent);
  else
    logger.warn(
      "!play requires Message Content Intent in the Discord Developer Portal; /play is available.",
    );
  return intents;
}
