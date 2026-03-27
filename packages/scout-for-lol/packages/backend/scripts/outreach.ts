/**
 * Ad-hoc Outreach Script
 *
 * One-time script to reach out to existing users and backfill GuildInstall records.
 *
 * Usage:
 *   bun scripts/outreach.ts           # Dry run (prints what would be sent)
 *   bun scripts/outreach.ts --send    # Actually send DMs
 */

import "dotenv/config";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("outreach-script");

const SEND_MODE = Bun.argv.includes("--send");
const ONLY_USER = Bun.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const SUPPORT_USER = "<@160509172704739328>";
const DM_DELAY_MS = 3000;
const DM_FOOTER =
  `\n\n**Note:** Replies to this bot cannot be read. ` +
  `If you need help with setup, troubleshooting, or have any feedback, ` +
  `please DM ${SUPPORT_USER} directly -- happy to help!`;

type OutreachGroup = {
  name: string;
  users: Array<{
    discordId: string;
    message: string;
    context: string;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Part 1: Backfill GuildInstall for all current guilds.
 * Sets both outreach timestamps to now so the automated cron skips them.
 */
async function backfillGuildInstalls(): Promise<void> {
  logger.info("[Backfill] Starting GuildInstall backfill...");

  const dbGuilds = await prisma.guildInstall.findMany({
    select: { serverId: true },
  });
  const existingServerIds = new Set(dbGuilds.map((g) => g.serverId));

  let created = 0;
  let skipped = 0;

  for (const [, guild] of client.guilds.cache) {
    const serverId = DiscordGuildIdSchema.parse(guild.id);

    if (existingServerIds.has(serverId)) {
      skipped++;
      continue;
    }

    const ownerId = DiscordAccountIdSchema.parse(guild.ownerId);
    const now = new Date();

    await prisma.guildInstall.create({
      data: {
        serverId,
        serverName: guild.name,
        ownerDiscordId: ownerId,
        addedByDiscordId: ownerId, // Can't determine installer for existing guilds
        memberCount: guild.memberCount,
        installedAt: now,
        outreach3dSentAt: now, // Skip automated outreach
        outreach14dSentAt: now, // Skip automated outreach
      },
    });
    created++;
    logger.info(
      `[Backfill] Created GuildInstall for ${guild.name} (${guild.id})`,
    );
  }

  logger.info(
    `[Backfill] ✅ Done: ${created.toString()} created, ${skipped.toString()} already existed`,
  );
}

/**
 * Part 2: Segment users and build outreach messages.
 */
async function buildOutreachGroups(): Promise<OutreachGroup[]> {
  // Get all subscription creators with counts and recency
  const subscriptions = await prisma.subscription.groupBy({
    by: ["creatorDiscordId"],
    _count: { id: true },
    _max: { createdTime: true },
  });

  // Get all competition creators/owners
  const competitions = await prisma.competition.groupBy({
    by: ["creatorDiscordId"],
    _count: { id: true },
  });
  const competitionOwners = await prisma.competition.groupBy({
    by: ["ownerId"],
    _count: { id: true },
  });

  // Build user profiles
  type UserProfile = {
    discordId: string;
    subCount: number;
    lastSubDate: Date | null;
    compCount: number;
    isCompOwner: boolean;
  };

  const profiles = new Map<string, UserProfile>();

  for (const sub of subscriptions) {
    profiles.set(sub.creatorDiscordId, {
      discordId: sub.creatorDiscordId,
      subCount: sub._count.id,
      lastSubDate: sub._max.createdTime,
      compCount: 0,
      isCompOwner: false,
    });
  }

  for (const comp of competitions) {
    const existing = profiles.get(comp.creatorDiscordId);
    if (existing !== undefined) {
      existing.compCount += comp._count.id;
    } else {
      profiles.set(comp.creatorDiscordId, {
        discordId: comp.creatorDiscordId,
        subCount: 0,
        lastSubDate: null,
        compCount: comp._count.id,
        isCompOwner: false,
      });
    }
  }

  for (const owner of competitionOwners) {
    const existing = profiles.get(owner.ownerId);
    if (existing !== undefined) {
      existing.isCompOwner = true;
    } else {
      profiles.set(owner.ownerId, {
        discordId: owner.ownerId,
        subCount: 0,
        lastSubDate: null,
        compCount: 0,
        isCompOwner: true,
      });
    }
  }

  const now = Date.now();
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

  const daysSince = (date: Date | null): number => {
    if (date === null) return Infinity;
    return Math.floor((now - date.getTime()) / (24 * 60 * 60 * 1000));
  };

  // Segment into groups
  const groupA: OutreachGroup = { name: "A: Active Power Users", users: [] };
  const groupB: OutreachGroup = { name: "B: Competition Users", users: [] };
  const groupC: OutreachGroup = { name: "C: Light Users", users: [] };
  const groupD: OutreachGroup = { name: "D: Established Users", users: [] };

  const usersInGroup = new Set<string>();

  const GETTING_STARTED = "https://scout-for-lol.com/getting-started/";

  // A user with comps but zero subs hasn't really set up
  const hasSetUp = (profile: UserProfile): boolean => profile.subCount > 0;

  // Group A: High engagement, recent activity, actually set up
  for (const [id, profile] of profiles) {
    const totalActions = profile.subCount + profile.compCount;
    const recentEnough =
      profile.lastSubDate !== null &&
      now - profile.lastSubDate.getTime() <= sixtyDaysMs;

    if (hasSetUp(profile) && totalActions >= 10 && recentEnough) {
      groupA.users.push({
        discordId: id,
        message:
          `👋 Hey there! How's Scout for LoL working for you? ` +
          `Any bugs or feature suggestions? I'd love to hear your feedback.` +
          DM_FOOTER,
        context: `${totalActions.toString()} actions, last ${daysSince(profile.lastSubDate).toString()}d ago`,
      });
      usersInGroup.add(id);
    }
  }

  // Group B: Competition users who also have subs (not in A)
  for (const [id, profile] of profiles) {
    if (usersInGroup.has(id)) continue;
    if ((profile.compCount > 0 || profile.isCompOwner) && hasSetUp(profile)) {
      groupB.users.push({
        discordId: id,
        message:
          `👋 Hey there! Saw you created a competition with Scout for LoL. ` +
          `Is it working as you expected? Any feedback?` +
          DM_FOOTER,
        context: `${profile.compCount.toString()} comp(s), ${profile.subCount.toString()} sub(s)`,
      });
      usersInGroup.add(id);
    }
  }

  // Group C: Light users (not in A/B, ≤4 subs)
  for (const [id, profile] of profiles) {
    if (usersInGroup.has(id)) continue;
    if (hasSetUp(profile) && profile.subCount <= 4) {
      groupC.users.push({
        discordId: id,
        message:
          `👋 Hey there! Thanks for trying out Scout for LoL! Need any help getting set up? ` +
          `Use \`/subscription add\` to track more players, or check out the getting started guide: ` +
          `${GETTING_STARTED}` +
          DM_FOOTER,
        context: `${profile.subCount.toString()} sub(s), last ${daysSince(profile.lastSubDate).toString()}d ago`,
      });
      usersInGroup.add(id);
    }
  }

  // Group D: Established users (not in A/B/C) - just solicit feedback
  for (const [id, profile] of profiles) {
    if (usersInGroup.has(id)) continue;
    if (hasSetUp(profile)) {
      groupD.users.push({
        discordId: id,
        message:
          `👋 Hey there! Thanks for using Scout for LoL. ` +
          `I'd love to hear any feedback or suggestions you have.` +
          DM_FOOTER,
        context: `${profile.subCount.toString()} sub(s), last ${daysSince(profile.lastSubDate).toString()}d ago`,
      });
      usersInGroup.add(id);
    }
  }

  // Group E: Ghost guild owners (bot in guild, no subs set up)
  // This includes users who only created comps with zero subs
  const groupE: OutreachGroup = { name: "E: Ghost Guild Owners", users: [] };

  const dbGuildIds = new Set(
    (
      await prisma.subscription.groupBy({
        by: ["serverId"],
      })
    ).map((g) => g.serverId),
  );

  for (const [, guild] of client.guilds.cache) {
    if (dbGuildIds.has(DiscordGuildIdSchema.parse(guild.id))) continue;

    try {
      const owner = await guild.fetchOwner();
      if (usersInGroup.has(owner.id)) continue;

      groupE.users.push({
        discordId: owner.id,
        message:
          `👋 Hey there! I noticed you added Scout for LoL to **${guild.name}** but haven't set anything up yet. ` +
          `Use \`/subscription add\` to start tracking your friends' League matches! ` +
          `Check out the getting started guide: ${GETTING_STARTED}` +
          DM_FOOTER,
        context: `Ghost guild: ${guild.name} (${guild.memberCount.toString()} members)`,
      });
      usersInGroup.add(owner.id);
    } catch {
      logger.warn(
        `[Outreach] Could not fetch owner for guild ${guild.name} (${guild.id})`,
      );
    }
  }

  return [groupA, groupB, groupC, groupD, groupE];
}

async function main(): Promise<void> {
  logger.info(`[Outreach] Mode: ${SEND_MODE ? "SEND" : "DRY RUN"}`);
  if (ONLY_USER !== undefined) {
    logger.info(`[Outreach] Targeting only user: ${ONLY_USER}`);
  }

  // Wait for Discord client to be ready
  if (!client.isReady()) {
    logger.info("[Outreach] Waiting for Discord client to be ready...");
    await new Promise<void>((resolve) => {
      client.once("ready", () => resolve());
    });
  }

  logger.info("[Outreach] Discord client ready");

  // Part 1: Backfill
  await backfillGuildInstalls();

  // Part 2: Segment and send
  const groups = await buildOutreachGroups();

  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const group of groups) {
    logger.info(`\n${"=".repeat(60)}`);
    logger.info(`${group.name} (${group.users.length.toString()} users)`);
    logger.info("=".repeat(60));

    for (const user of group.users) {
      const isTargeted =
        ONLY_USER === undefined || user.discordId === ONLY_USER;
      logger.info(`  ${user.discordId} — ${user.context}`);
      logger.info(`  Message: ${user.message.substring(0, 100)}...`);

      if (!isTargeted) {
        logger.info(`  ⏭️  Skipped (not targeted)`);
        totalSkipped++;
        continue;
      }

      if (SEND_MODE) {
        const userId = DiscordAccountIdSchema.parse(user.discordId);
        const sent = await sendDM(client, userId, user.message);
        if (sent) {
          totalSent++;
          logger.info(`  ✅ Sent`);
        } else {
          totalFailed++;
          logger.info(`  ❌ Failed`);
        }
        await sleep(DM_DELAY_MS);
      } else {
        totalSkipped++;
        logger.info(`  ⏭️  Skipped (dry run)`);
      }
    }
  }

  logger.info(`\n${"=".repeat(60)}`);
  logger.info("[Outreach] Summary:");
  logger.info(`  Sent: ${totalSent.toString()}`);
  logger.info(`  Failed: ${totalFailed.toString()}`);
  logger.info(`  Skipped (dry run): ${totalSkipped.toString()}`);
  logger.info("=".repeat(60));

  await prisma.$disconnect();
  process.exit(0);
}

void main();
