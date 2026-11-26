import { afterEach, describe, expect, test, vi } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  initializeDynamicConfig,
  shutdownDynamicConfig,
  type DynamicConfigSeed,
} from "#src/config/dynamic.ts";
import { DEFAULT_EXPLORE_QUOTA_LIMITS } from "#src/configuration/explore-quota.ts";

const mocks = vi.hoisted(() => ({
  createPrismaCrawlStore: vi.fn(),
  createCrawlRiotClient: vi.fn(),
  createS3Client: vi.fn(),
}));

// Production configuration: the crawl must answer to the flag alone here.
vi.mock("#src/configuration.ts", () => ({
  default: {
    environment: "prod",
    s3BucketName: "scout-prod",
    riotApiToken: "test-token",
    runtimeCapabilities: {
      temporalWorkers: ["realtime", "background", "crawl"],
      deferredTemporalWorkers: [],
    },
  },
}));
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));
vi.mock("#src/storage/s3-client.ts", () => ({
  createS3Client: mocks.createS3Client,
}));
vi.mock("./crawl-prisma-store.ts", () => ({
  createPrismaCrawlStore: mocks.createPrismaCrawlStore,
}));
vi.mock("./crawl-riot-client.ts", () => ({
  createCrawlRiotClient: mocks.createCrawlRiotClient,
}));

const { crawlEnabledHere, runParticipantCrawlActivity } =
  await import("./crawl-activity.ts");

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;
const SEED: DynamicConfigSeed = {
  exploreGuildAllowlist: [],
  exploreQuotaLimits: DEFAULT_EXPLORE_QUOTA_LIMITS,
  exploreModel: "gpt-6-luna",
  llmHourlyTokenBudget: 2_000_000,
  llmDailyTokenBudget: 20_000_000,
  temporalCallGraphTracing: false,
};

const heartbeat = vi.fn();

afterEach(async () => {
  await shutdownDynamicConfig();
  vi.clearAllMocks();
});

describe("participant crawl activity in production configuration", () => {
  test("with the flag off it is a no-op that touches no store, bucket or Riot client", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({
        "scout-participant-crawl-enabled": false,
      }),
    });

    expect(crawlEnabledHere()).toBe(false);
    const result = await runParticipantCrawlActivity(heartbeat);

    expect(result).toEqual({
      status: "disabled",
      seededObservations: 0,
      admittedPlayers: 0,
      playersVisited: 0,
      matchesStored: 0,
      segmentsWritten: 0,
    });
    expect(mocks.createPrismaCrawlStore).not.toHaveBeenCalled();
    expect(mocks.createS3Client).not.toHaveBeenCalled();
    expect(mocks.createCrawlRiotClient).not.toHaveBeenCalled();
  });

  test("with the flag unanswered it stays off", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });

    expect(crawlEnabledHere()).toBe(false);
    const result = await runParticipantCrawlActivity(heartbeat);
    expect(result.status).toBe("disabled");
    expect(mocks.createPrismaCrawlStore).not.toHaveBeenCalled();
  });

  test("with the flag on it passes the gate and runs the tick", async () => {
    // A zero daily budget ends the tick right after the gate, so the run
    // reaches the store without a Riot call.
    const matchesCrawledSince = vi.fn(() => Promise.resolve(0));
    mocks.createPrismaCrawlStore.mockReturnValue({ matchesCrawledSince });
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({
        "scout-participant-crawl-enabled": true,
        "scout-participant-crawl-daily-match-budget": 0,
      }),
    });

    expect(crawlEnabledHere()).toBe(true);
    const result = await runParticipantCrawlActivity(heartbeat);

    expect(result.status).toBe("budget-exhausted");
    expect(mocks.createPrismaCrawlStore).toHaveBeenCalledTimes(1);
    expect(matchesCrawledSince).toHaveBeenCalledTimes(1);
  });
});
