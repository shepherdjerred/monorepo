/**
 * Deploy-time one-shot: silently close every season-based Competition whose
 * Season has already ended but whose `endProcessedAt` is still NULL. This
 * keeps the lifecycle cron's "to-end" filter from firing a retroactive
 * leaderboard for months-old competitions.
 *
 * After updating each row, the script groups affected competitions by
 * channel and posts ONE consolidated notice per channel so server owners
 * can find the closed comps if they care.
 *
 * Idempotent: re-runs find no candidates (because `endProcessedAt` is set)
 * and do nothing. On partial crash, any comp that was updated but not
 * noticed stays quietly closed — acceptable for a one-shot.
 *
 * Required env:
 *   DATABASE_URL              path to the SQLite DB
 *   DISCORD_BOT_TOKEN         standard bot token used to post notices
 *
 *   bun run scripts/backfill-overdue-season-comps.ts
 */

import { SEASONS } from "@scout-for-lol/data";
import { Client, GatewayIntentBits } from "discord.js";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("backfill-overdue-season-comps");

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: Bun.env["DATABASE_URL"] ?? "file:./db.sqlite",
  }),
});

type AffectedComp = {
  id: number;
  title: string;
  channelId: string;
};

const now = new Date();
const affectedByChannel = new Map<string, AffectedComp[]>();
let totalUpdated = 0;

for (const season of Object.values(SEASONS)) {
  if (season.endDate > now) continue;

  const overdue = await prisma.competition.findMany({
    where: {
      seasonId: season.id,
      endProcessedAt: null,
      isCancelled: false,
    },
    select: { id: true, title: true, channelId: true, startProcessedAt: true },
  });

  for (const comp of overdue) {
    await prisma.competition.update({
      where: { id: comp.id },
      data: {
        startProcessedAt: comp.startProcessedAt ?? season.startDate,
        endProcessedAt: season.endDate,
      },
    });
    totalUpdated++;

    const bucket = affectedByChannel.get(comp.channelId) ?? [];
    bucket.push({ id: comp.id, title: comp.title, channelId: comp.channelId });
    affectedByChannel.set(comp.channelId, bucket);
  }
}

logger.info(
  `🤫 Silently closed ${totalUpdated.toString()} overdue season-based competition(s) across ${affectedByChannel.size.toString()} channel(s).`,
);

if (affectedByChannel.size === 0) {
  logger.info("Nothing to notify — exiting.");
  await prisma.$disconnect();
  process.exit(0);
}

// Boot a minimal Discord client just to post the notices, then exit.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(configuration.discordToken);

await new Promise<void>((resolve) => {
  client.once("ready", () => {
    resolve();
  });
});

let channelsNotified = 0;
let channelsSkipped = 0;

for (const [channelId, comps] of affectedByChannel) {
  const lines = [
    "ℹ️ The following competitions tied to past seasons have been silently closed during a maintenance update. No final notifications were sent.",
    ...comps.map(
      (c) =>
        `- **${c.title}** (ID ${c.id.toString()}) — use \`/competition view id:${c.id.toString()}\` for details`,
    ),
  ];

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel === null || !channel.isSendable()) {
      logger.warn(
        `[backfill] Channel ${channelId} not found or not sendable; skipping notice for ${comps.length.toString()} comp(s).`,
      );
      channelsSkipped++;
      continue;
    }
    await channel.send(lines.join("\n"));
    channelsNotified++;
  } catch (error) {
    logger.warn(
      `[backfill] Failed to post notice to channel ${channelId}: ${String(error)}`,
    );
    channelsSkipped++;
  }
}

logger.info(
  `✅ Notice posted to ${channelsNotified.toString()} channel(s); skipped ${channelsSkipped.toString()}.`,
);

await client.destroy();
await prisma.$disconnect();
process.exit(0);
