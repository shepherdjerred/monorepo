import path from "node:path";
import { gameplayFixtures } from "#e2e/gameplay-fixtures.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { ownedConfigDir, packageRoot } from "#e2e/harness/paths.ts";
import { rwfRecordingSalt } from "#e2e/harness/rwf-settings.ts";
import { startServer, type StartServerOptions } from "#e2e/harness/server.ts";

/** What differs between local Storm servers for watching or measuring bots. */
export type LocalStormOptions = Pick<
  StartServerOptions,
  "stormJar" | "rwf" | "rwfMap" | "dataDir" | "resources" | "gamePort"
> & {
  /** Names the server's cache directory under `.cache/e2e`. */
  cacheName: string;
};

/**
 * Boots a disposable Paper server with every shipped module, Search and
 * Destroy, its Citizens bots and a fake brain (`../rwf-watch.ts`,
 * `bots/match.ts`). `stop` removes the container and the brain.
 */
export async function startLocalStorm(options: LocalStormOptions) {
  if (!(await Bun.file(options.stormJar).exists())) {
    throw new Error(
      `${options.stormJar} is missing; build it first with: bunx turbo run build --filter=@shepherdjerred/the-storm`,
    );
  }
  const { cacheName, ...overrides } = options;
  const brainToken = crypto.randomUUID();
  const brain = startFakeBrain(brainToken);
  const brainBaseUrl = `http://host.docker.internal:${brain.port.toString()}`;
  const fixtures = await gameplayFixtures(packageRoot, "full");
  const server = await startServer({
    cacheDir: path.join(packageRoot, ".cache", "e2e", cacheName),
    bootTimeoutMs: 300_000,
    warmCache: true,
    ...fixtures,
    ...overrides,
    ownedConfigDir,
    env: {
      // The fake brain's Flipt double admits /rwf join and /rwf spectate.
      FLIPT_URL: brainBaseUrl,
      FLIPT_ENVIRONMENT: "prod",
      POSTHOG_API_HOST: brainBaseUrl,
      POSTHOG_PROJECT_TOKEN: "phc_test",
      RWF_RECORDING_SALT: rwfRecordingSalt,
      // The discord module needs a token; this malformed one never logs in.
      DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
      DISCORD_CHANNEL_ID: "1",
    },
    brain: { baseUrl: brainBaseUrl, token: brainToken },
    sweep: {
      intervalMinutes: 1,
      redriveAfterMinutes: 0,
      redriveBackoffMinutes: 0,
      slaAfterMinutes: 10_080,
    },
    agent: { mode: "shadow", reviewSamplePercent: 100 },
  });
  return {
    info: server.info,
    async stop(): Promise<void> {
      await server.stop();
      await brain.stop();
    },
  };
}
