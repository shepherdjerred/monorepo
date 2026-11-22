import { seedDemoData } from "@shepherdjerred/storm-stats/seed-demo.ts";
import { createIngestApp, createPublicApp, createStaffApp } from "./app.ts";
import {
  createStormStatsBehaviorResolver,
  loadStormStatsBootstrap,
  type EnvMap,
} from "./config.ts";
import { initStormStatsFlags, shutdownStormStatsFlags } from "./flags.ts";
import { createStormStatsMetrics, type StormStatsMetrics } from "./metrics.ts";
import { DEFAULT_CLIENT_ROOT } from "./static.ts";
import { StormStatsStore } from "./store.ts";

export type StormStatsRunningServer = {
  readonly port: number;
  readonly hostname: string | undefined;
  readonly adminPort: number | undefined;
  readonly ingestPort: number | undefined;
  readonly store: StormStatsStore;
  readonly metrics: StormStatsMetrics;
  readonly stop: (closeActiveConnections?: boolean) => Promise<void>;
};

export type StartStormStatsOptions = {
  readonly port?: number;
  readonly hostname?: string;
  readonly env?: EnvMap;
  readonly clientRoot?: string;
};

export async function startStormStatsServer(
  options: StartStormStatsOptions = {},
): Promise<StormStatsRunningServer> {
  const env = options.env ?? Bun.env;
  const bootstrap = loadStormStatsBootstrap(env);
  const port = options.port ?? bootstrap.port;
  const hostname = options.hostname ?? bootstrap.host;
  const clientRoot = options.clientRoot ?? DEFAULT_CLIENT_ROOT;

  const metrics = createStormStatsMetrics();
  const flagsInitialized = await initStormStatsFlags({
    env,
    mode: bootstrap.featureFlagsMode,
    metrics: metrics.featureFlags,
  });

  const behavior = createStormStatsBehaviorResolver({
    env,
    environmentStage: bootstrap.environment,
    flagsDisabled: !flagsInitialized,
  });

  const store = StormStatsStore.open(bootstrap.databasePath);
  const startedServers: ReturnType<typeof Bun.serve>[] = [];

  try {
    if (bootstrap.seedDemo && store.playerCount() === 0) {
      const seeded = seedDemoData(store);
      console.warn(
        JSON.stringify({
          message: "storm_stats_demo_seeded",
          service: "storm-stats",
          playersSeeded: seeded.playersSeeded,
          batchesIngested: seeded.batchesIngested,
        }),
      );
    }

    const publicApp = createPublicApp({
      store,
      publicEnabled: () => behavior.value("publicEnabled"),
      metrics,
      clientRoot,
    });

    const publicServer = Bun.serve({
      port,
      hostname,
      fetch: publicApp.fetch,
    });
    startedServers.push(publicServer);
    if (publicServer.port === undefined) {
      throw new Error("storm-stats public server did not bind a TCP port");
    }

    let adminServer: ReturnType<typeof Bun.serve> | undefined;
    if (bootstrap.adminPort !== undefined) {
      const staffApp = createStaffApp({
        store,
        publicEnabled: () => behavior.value("publicEnabled"),
        metrics,
        clientRoot,
      });
      adminServer = Bun.serve({
        port: bootstrap.adminPort,
        hostname,
        fetch: staffApp.fetch,
      });
      startedServers.push(adminServer);
      if (adminServer.port === undefined) {
        throw new Error("storm-stats admin server did not bind a TCP port");
      }
      console.warn(
        `storm-stats staff admin listening on :${String(adminServer.port)}`,
      );
    }

    let ingestServer: ReturnType<typeof Bun.serve> | undefined;
    if (
      bootstrap.ingestPort !== undefined &&
      bootstrap.ingestToken !== undefined
    ) {
      const ingestApp = createIngestApp({
        store,
        ingestToken: bootstrap.ingestToken,
        ingestEnabled: () => behavior.value("ingestEnabled"),
        metrics,
      });
      ingestServer = Bun.serve({
        port: bootstrap.ingestPort,
        hostname,
        fetch: ingestApp.fetch,
      });
      startedServers.push(ingestServer);
      if (ingestServer.port === undefined) {
        throw new Error("storm-stats ingest server did not bind a TCP port");
      }
      console.warn(
        `storm-stats ingest listening on :${String(ingestServer.port)}`,
      );
    }

    console.warn(
      `storm-stats public listening on :${String(publicServer.port)}`,
    );

    return {
      port: publicServer.port,
      hostname: publicServer.hostname,
      adminPort: adminServer?.port,
      ingestPort: ingestServer?.port,
      store,
      metrics,
      async stop(closeActiveConnections?: boolean) {
        await Promise.all(
          startedServers.map((srv) => srv.stop(closeActiveConnections)),
        );
        if (flagsInitialized) {
          await shutdownStormStatsFlags();
        }
        store.close();
      },
    };
  } catch (error) {
    await Promise.all(startedServers.map((srv) => srv.stop(true)));
    if (flagsInitialized) {
      await shutdownStormStatsFlags();
    }
    store.close();
    throw error;
  }
}
