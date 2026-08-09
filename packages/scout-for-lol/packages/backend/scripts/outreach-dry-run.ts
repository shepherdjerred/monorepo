/**
 * Outreach dry run.
 *
 * Prints what the ladder WOULD send for every install, without contacting
 * Discord or writing anything. The failure mode of this subsystem is messaging
 * real people, so the stage backfill and ladder decisions should be eyeballed
 * against a copy of production before the first real fire.
 *
 * Usage (against a copy of the prod DB — never point this at prod itself):
 *   DATABASE_URL=file:./prod-copy.sqlite bun run scripts/outreach-dry-run.ts
 */

import { prisma } from "#src/database/index.ts";
import { planOutreach } from "#src/league/tasks/outreach/index.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("outreach-dry-run");

const now = new Date();
const installs = await prisma.guildInstall.findMany({
  where: { removedAt: null },
  orderBy: { installedAt: "asc" },
});

const tally = new Map<string, number>();

for (const install of installs) {
  const [subscriptions, competitions] = await Promise.all([
    prisma.subscription.count({ where: { serverId: install.serverId } }),
    prisma.competition.count({
      where: { serverId: install.serverId, isCancelled: false },
    }),
  ]);

  const outreach = await readOutreachState(
    prisma,
    install.serverId,
    install.installedAt,
  );

  const plan = planOutreach({
    serverName: install.serverName,
    installedAt: install.installedAt,
    outreachStage: outreach.spent,
    lastLadderStage: outreach.lastLadderStage,
    feedbackRequested: outreach.feedbackRequested,
    state: { subscriptions, competitions },
    now,
  });

  const outcome =
    plan.action === "send"
      ? `SEND stage ${plan.stage.toString()} (${plan.kind})`
      : `skip stage ${plan.stage.toString()} (${plan.reason})`;
  tally.set(outcome, (tally.get(outcome) ?? 0) + 1);

  const ageDays = Math.floor(
    (now.getTime() - install.installedAt.getTime()) / 86_400_000,
  );
  logger.info(
    `${install.serverName.padEnd(34).slice(0, 34)} age=${ageDays.toString().padStart(4)}d ` +
      `spent=${outreach.spent.toString()} rung=${outreach.lastLadderStage.toString()} subs=${subscriptions.toString()} comps=${competitions.toString()} → ${outcome}`,
  );
}

logger.info(`\n=== Summary over ${installs.length.toString()} install(s) ===`);
for (const [outcome, count] of [...tally.entries()].sort(
  (a, b) => b[1] - a[1],
)) {
  logger.info(`  ${count.toString().padStart(4)}  ${outcome}`);
}

await prisma.$disconnect();
