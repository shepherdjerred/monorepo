import configuration from "#src/configuration.ts";
import {
  participantCrawlDailyMatchBudget,
  participantCrawlEnabled,
} from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { riotBudgetLedger } from "#src/league/api/riot-budget-ledger.ts";
import {
  crawlBudgetRefusalsTotal,
  crawlTicksTotal,
  crawlUtilisationTargetRatio,
} from "#src/metrics/crawl.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { writeCrawlInboxSegment } from "#src/report-lake/crawl/crawl-inbox.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { createS3CrawlObjectStore } from "./crawl-object-store.ts";
import { createPrismaCrawlStore } from "./crawl-prisma-store.ts";
import { createCrawlRiotClient } from "./crawl-riot-client.ts";
import {
  idleTickResult,
  runCrawlTick,
  type CrawlTickResult,
} from "./crawl-run.ts";

/**
 * The crawl's one Riot client for this process. It shares the process's
 * budget ledger with the tracked client, so the ledger counts the crawl's own
 * share of Riot's key-wide window counts exactly and holds the crawl to what
 * tracked traffic leaves of `scout-participant-crawl-utilisation-target`.
 */
let crawlRiot: ReturnType<typeof createCrawlRiotClient> | undefined;

function crawlRiotClient() {
  crawlRiot ??= createCrawlRiotClient({
    apiKey: configuration.riotApiToken,
    ledger: riotBudgetLedger(),
    onBudgetRefusal: (refusal) => {
      crawlBudgetRefusalsTotal.inc({ reason: refusal.reason });
    },
  });
  return crawlRiot;
}

/** Whether the crawl runs here: the `scout-participant-crawl-enabled` flag alone decides, in every environment. */
export function crawlEnabledHere(): boolean {
  return participantCrawlEnabled();
}

/** One scheduled crawl tick, wired to PostgreSQL, S3 and the crawl Riot client. */
export async function runParticipantCrawlActivity(
  heartbeat: () => void,
): Promise<CrawlTickResult> {
  if (!crawlEnabledHere()) {
    crawlTicksTotal.inc({ status: "disabled" });
    return idleTickResult("disabled");
  }
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    throw new Error("The participant crawl requires S3_BUCKET_NAME");
  }
  crawlUtilisationTargetRatio.set(riotBudgetLedger().crawlTarget());
  return await runCrawlTick({
    store: createPrismaCrawlStore(prisma),
    riot: crawlRiotClient(),
    objects: createS3CrawlObjectStore(createS3Client(), bucket),
    lakeInbox: async (segment) => {
      await writeCrawlInboxSegment(resolveLakeDir(), segment);
    },
    now: () => new Date(),
    sleep: (milliseconds) => Bun.sleep(milliseconds),
    enabled: crawlEnabledHere,
    dailyMatchBudget: participantCrawlDailyMatchBudget,
    heartbeat,
  });
}
