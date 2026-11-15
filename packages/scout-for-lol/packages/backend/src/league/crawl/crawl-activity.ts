import configuration from "#src/configuration.ts";
import {
  participantCrawlDailyMatchBudget,
  participantCrawlEnabled,
  riotBudgetMode,
} from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import {
  crawlBudgetRefusalsTotal,
  crawlTicksTotal,
} from "#src/metrics/crawl.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { crawlHardDisabledIn } from "./crawl-config.ts";
import { createS3CrawlObjectStore } from "./crawl-object-store.ts";
import { createPrismaCrawlStore } from "./crawl-prisma-store.ts";
import { createCrawlRiotClient } from "./crawl-riot-client.ts";
import {
  idleTickResult,
  runCrawlTick,
  type CrawlTickResult,
} from "./crawl-run.ts";

/**
 * The crawl's one Riot client for this process. Its ledger learns usage from
 * crawl responses only; Riot's key-wide count header carries what every pod
 * has spent, which is what lets it hold the crawl under its ceiling.
 */
let crawlRiot: ReturnType<typeof createCrawlRiotClient> | undefined;

function crawlRiotClient() {
  crawlRiot ??= createCrawlRiotClient({
    apiKey: configuration.riotApiToken,
    budgetMode: riotBudgetMode,
    onBudgetRefusal: (refusal) => {
      crawlBudgetRefusalsTotal.inc({ reason: refusal.reason });
    },
  });
  return crawlRiot;
}

/** Whether the crawl runs here: the flag, and never in production before gate 3. */
export function crawlEnabledHere(): boolean {
  return (
    participantCrawlEnabled() && !crawlHardDisabledIn(configuration.environment)
  );
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
  return await runCrawlTick({
    store: createPrismaCrawlStore(prisma),
    riot: crawlRiotClient(),
    objects: createS3CrawlObjectStore(createS3Client(), bucket),
    now: () => new Date(),
    enabled: crawlEnabledHere,
    dailyMatchBudget: participantCrawlDailyMatchBudget,
    heartbeat,
  });
}
