/**
 * Erase one player from the participant crawl.
 *
 *   bun run scripts/repair/erase-crawled-player.ts --puuid <PUUID> [--riot-id 'Name#TAG']
 *   bun run scripts/repair/erase-crawled-player.ts --riot-id 'Name#TAG' --region AMERICA_NORTH --apply
 *
 * Without `--apply` this prints what the request would change and how far an
 * earlier request has got, and changes nothing. With `--apply` it records the
 * PUUID's hash in `ErasedPuuid`, deletes the frontier row and redacts stored
 * Explore copies; the lake fold and rebuild Schedules then rewrite raw
 * segments and lake files. Run it with the production database environment
 * (and `RIOT_API_KEY` for `--region`). See the wiki how-to "Erase a crawled
 * player".
 */
import { parseArgs } from "node:util";
import {
  LeaguePuuidSchema,
  RegionSchema,
  RiotIdSchema,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  applyCrawlErasure,
  crawlErasureComplete,
  planCrawlErasure,
  type CrawlErasurePlan,
} from "#src/league/crawl/crawl-erasure.ts";
import { resolveRiotIdToPuuid } from "#src/lib/riot/resolve-puuid.ts";

const logger = createLogger("erase-crawled-player");

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    puuid: { type: "string" },
    "riot-id": { type: "string" },
    region: { type: "string" },
    apply: { type: "boolean", default: false },
  },
  strict: true,
});

async function targetPuuid(): Promise<LeaguePuuid> {
  if (values.puuid !== undefined) return LeaguePuuidSchema.parse(values.puuid);
  if (values["riot-id"] === undefined || values.region === undefined) {
    throw new Error(
      "Pass --puuid <PUUID>, or --riot-id 'Name#TAG' with --region <region>",
    );
  }
  const resolved = await resolveRiotIdToPuuid(
    RiotIdSchema.parse(values["riot-id"]),
    RegionSchema.parse(values.region),
  );
  if (resolved.kind !== "ok") {
    throw new Error(
      `Riot has no account ${values["riot-id"]}: ${resolved.message}`,
    );
  }
  return resolved.puuid;
}

function describe(plan: CrawlErasurePlan): string[] {
  const { progress, copies } = plan;
  return [
    `PUUID hash: ${plan.puuidHash}`,
    progress === null
      ? "Erasure: not recorded"
      : `Erasure: recorded ${progress.erasedAt.toISOString()}; raw segments ${progress.rawSweptAt === null ? "sweeping" : `swept ${progress.rawSweptAt.toISOString()}`} (${progress.segmentsRewritten.toString()} rewritten, ${progress.matchesRemoved.toString()} matches removed); lake ${progress.lakeErasedAt === null ? "pending (tombstoned at query time)" : `erased ${progress.lakeErasedAt.toISOString()}`}; ${progress.queuedObjectDeletions.toString()} crawl objects queued for deletion`,
    `Frontier row: ${plan.frontierRow ? "present" : "absent"}; crawled matches visited from this player: ${plan.matchesVisited.toString()}`,
    `Explore copies naming the player: ${copies.toolPayloads.toString()} tool payloads, ${copies.messages.toString()} answers (${copies.sharedConversations.toString()} shared conversations), ${copies.runs.toString()} runs`,
    `Complete: ${crawlErasureComplete(progress) ? "yes" : "no"}`,
  ];
}

try {
  const target = { puuid: await targetPuuid(), riotId: values["riot-id"] };
  for (const line of describe(await planCrawlErasure(prisma, target))) {
    logger.info(line);
  }
  if (values.apply) {
    const result = await applyCrawlErasure(prisma, target);
    logger.info(
      `Applied: ${result.newlyRecorded ? "recorded the erasure" : "erasure was already recorded"}; deleted ${result.frontierRowsDeleted.toString()} frontier rows; redacted ${result.copies.toolPayloads.toString()} tool payloads, ${result.copies.messages.toString()} answers and ${result.copies.runs.toString()} runs.`,
    );
    logger.info(
      "The next lake fold rewrites the lake and raw segments. Rerun without --apply to check progress.",
    );
  } else {
    logger.info(
      "Dry run: nothing changed. Pass --apply to record the erasure.",
    );
  }
} finally {
  await prisma.$disconnect();
}
