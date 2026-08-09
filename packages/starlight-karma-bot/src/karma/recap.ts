/** Scheduled recap: the bot speaking first.
 *
 *  Usage fell 216 → 106 → 15 events/year, and a bot nobody invokes may as well
 *  not exist. The recap surfaces the leaderboard, the most generous, and a
 *  slice of the archive without anyone typing a command.
 *
 *  Modeled on Scout's competition dispatcher
 *  (`league/tasks/competition/scheduled-update-dispatcher.ts`): poll for due
 *  rows once a minute, post, and advance the next-fire timestamp — including
 *  when posting fails, so a deleted channel is not retried every minute
 *  forever. */
import * as Sentry from "@sentry/bun";
import { bold, ChannelType, time, userMention } from "discord.js";
import client from "#src/discord/client.ts";
import { prisma } from "#src/db/index.ts";
import { getLeaderboard } from "#src/karma/queries.ts";
import { computeNextRecapAt } from "#src/karma/recap-schedule.ts";

const POLL_INTERVAL_MS = 60_000;
const RECAP_TOP_N = 5;

/** Guilds whose recap is due. A null `nextRecapAt` counts as due — that is the
 *  self-heal path for a row enabled before a time was ever computed. */
async function getDueGuilds(now: Date) {
  return prisma.guildConfig.findMany({
    where: {
      enabled: true,
      NOT: { recapChannelId: null },
      OR: [{ nextRecapAt: { lte: now } }, { nextRecapAt: null }],
    },
    orderBy: { nextRecapAt: "asc" },
  });
}

async function displayName(id: string): Promise<string> {
  const user = await client.users.fetch(id, { cache: true });
  return user.username;
}

/** Karma given on this calendar day in any previous year.
 *  The archive is the bot's most valuable and least used asset: 362 entries
 *  going back to 2023, 89% of them carrying a human-written reason. */
async function onThisDay(guildId: string, now: Date) {
  const rows = await prisma.karma.findMany({
    where: {
      guildId,
      reason: { not: null },
      amount: { gt: 0 },
      datetime: { lt: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { datetime: "desc" },
    select: {
      datetime: true,
      reason: true,
      giverId: true,
      receiverId: true,
    },
  });
  return rows.filter(
    (row) =>
      row.datetime.getUTCMonth() === now.getUTCMonth() &&
      row.datetime.getUTCDate() === now.getUTCDate(),
  );
}

export async function buildRecap(
  guildId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const [received, given, memories] = await Promise.all([
    getLeaderboard({ guildId, kind: "received", period: "month", now }),
    getLeaderboard({ guildId, kind: "given", period: "month", now }),
    onThisDay(guildId, now),
  ]);

  if (received.length === 0 && given.length === 0 && memories.length === 0) {
    // Nothing happened and nothing to reminisce about — stay quiet rather than
    // posting an empty recap every week.
    return null;
  }

  const sections: string[] = ["**Karma recap**"];

  if (received.length > 0) {
    const lines = await Promise.all(
      received.slice(0, RECAP_TOP_N).map(async (entry) => {
        const name = await displayName(entry.id);
        return `#${entry.rank.toString()} ${name} — ${bold(entry.karmaReceived.toString())}`;
      }),
    );
    sections.push(`\nMost karma this month:\n${lines.join("\n")}`);
  }

  if (given.length > 0) {
    const lines = await Promise.all(
      given.slice(0, 3).map(async (entry) => {
        const name = await displayName(entry.id);
        return `#${entry.rank.toString()} ${name} — ${bold(entry.karmaReceived.toString())} given`;
      }),
    );
    sections.push(`\nMost generous this month:\n${lines.join("\n")}`);
  }

  const memory = memories[0];
  if (memory !== undefined) {
    sections.push(
      `\nOn this day, ${time(memory.datetime, "D")}:\n${userMention(memory.giverId)} gave ${userMention(memory.receiverId)} karma for \`${memory.reason ?? ""}\``,
    );
  }

  return sections.join("\n");
}

async function postRecap(guildId: string, channelId: string): Promise<void> {
  const recap = await buildRecap(guildId);
  if (recap === null) {
    console.warn(`[Recap] Nothing to report for guild ${guildId}`);
    return;
  }
  const channel = await client.channels.fetch(channelId);
  if (channel?.type !== ChannelType.GuildText) {
    throw new Error(
      `Recap channel ${channelId} is missing or not a text channel`,
    );
  }
  await channel.send({ content: recap });
  console.warn(`[Recap] Posted recap for guild ${guildId}`);
}

/** One dispatcher pass. Exported so it can be driven directly in a dry run. */
export async function runDueRecaps(now: Date = new Date()): Promise<void> {
  const due = await getDueGuilds(now);
  if (due.length === 0) {
    return;
  }

  for (const config of due) {
    const { recapChannelId } = config;
    try {
      if (recapChannelId !== null) {
        await postRecap(config.guildId, recapChannelId);
      }
    } catch (error) {
      console.error(`[Recap] Failed for guild ${config.guildId}:`, error);
      Sentry.captureException(error, { tags: { source: "karma-recap" } });
    } finally {
      // Advance even on failure. Otherwise a deleted channel or a revoked
      // permission turns into a post attempt every single minute.
      await prisma.guildConfig.update({
        where: { guildId: config.guildId },
        data: {
          nextRecapAt: computeNextRecapAt(config.recapCron, now),
          lastRecapAt: now,
        },
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startRecapDispatcher(): void {
  if (timer !== null) {
    throw new Error("Recap dispatcher is already running");
  }
  timer = setInterval(() => {
    void (async () => {
      try {
        await runDueRecaps();
      } catch (error) {
        console.error("[Recap] Dispatcher pass failed:", error);
        Sentry.captureException(error, {
          tags: { source: "karma-recap-poll" },
        });
      }
    })();
  }, POLL_INTERVAL_MS);
  // Do not hold the process open solely for the dispatcher.
  timer.unref();
  console.warn("[Recap] Dispatcher started");
}
