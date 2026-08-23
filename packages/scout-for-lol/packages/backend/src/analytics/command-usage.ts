import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  getProductAnalytics,
  type DiscordCommandStatus,
  type ProductAnalytics,
} from "#src/analytics/product-analytics.ts";

const logger = createLogger("command-usage-analytics");

/**
 * The closed set of command names this event may carry. Discord can deliver
 * stale or unregistered names (a guild whose command list has not reconciled
 * yet), and those must not mint new property values — they stay visible in
 * the `discord_commands_total` Prometheus counter instead.
 */
const DiscordCommandNameSchema = z.enum([
  "help",
  "setup",
  "status",
  "invite",
  "docs",
  "track",
  "list",
  "bb",
  "scout",
]);

/**
 * Capture one `discord_command_used` product analytics event against the
 * guild's installation identity.
 *
 * This is a best-effort interaction boundary: it validates everything it is
 * given and never throws, because it runs in the command dispatcher's
 * `finally` where an exception would replace the command's own error. DM
 * invocations are skipped — there is no guild installation to identify with —
 * and remain visible in Prometheus.
 */
export async function captureDiscordCommandUsed(
  input: {
    guildId: string | null;
    commandName: string;
    status: DiscordCommandStatus;
  },
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
  },
): Promise<void> {
  try {
    if (input.guildId === null) {
      return;
    }
    const guildId = DiscordGuildIdSchema.safeParse(input.guildId);
    if (!guildId.success) {
      return;
    }
    const commandName = DiscordCommandNameSchema.safeParse(input.commandName);
    if (!commandName.success) {
      return;
    }

    const db = options?.db ?? prisma;
    const analytics = options?.analytics ?? getProductAnalytics();
    const install = await db.guildInstall.findUnique({
      where: { serverId: guildId.data },
      select: {
        serverId: true,
        analyticsInstallationId: true,
        analyticsLifecycleTracked: true,
      },
    });
    if (install === null) {
      logger.warn(
        "Cannot capture command usage without a GuildInstall lifecycle row",
      );
      return;
    }

    analytics.capture(install, {
      event: "discord_command_used",
      properties: { command_name: commandName.data, status: input.status },
    });
  } catch (error) {
    logger.error(
      "Failed to capture command usage analytics",
      getErrorMessage(error),
    );
  }
}
