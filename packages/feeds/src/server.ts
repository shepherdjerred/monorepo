import { randomBytes } from "node:crypto";
import {
  initFeatureFlags,
  isEnabled,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  createFeedsConsoleApp,
  createFeedsReaderApp,
  type ReaderCredentialsConfig,
} from "./server/app.ts";
import { authFromEnv } from "./server/auth.ts";
import { createFeedsMetrics, type FeedsMetrics } from "./server/metrics.ts";
import {
  createFeedsPoller,
  type CreateFeedsPollerDeps,
} from "./server/poller.ts";
import { asyncFeedsRepository } from "./server/sqlite-repository.ts";
import { FeedsStore } from "./server/store.ts";
import type { FeedsPoller, FeedsRepository } from "./server/types.ts";

const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/u;
const peers = new WeakMap<Request, string | null>();

function peerAddress(request: Request): string | null {
  return peers.get(request) ?? null;
}

function parseOptionalPort(
  raw: string | undefined,
  envName: string,
): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  if (!NON_NEGATIVE_INTEGER.test(raw)) {
    throw new Error(`Invalid ${envName}: ${raw}`);
  }
  const parsed = Number(raw);
  if (parsed < 0 || parsed > 65_535 || !Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${envName}: ${raw}`);
  }
  return parsed;
}

function readerConfigFromEnv(
  env: NodeJS.ProcessEnv,
  requireReader: boolean,
): ReaderCredentialsConfig | undefined {
  const readerUser = env["FEEDS_READER_USER"]?.trim() ?? "sjerred";
  const readerPassword = env["FEEDS_READER_PASSWORD"];
  const writeTokenSecret = env["FEEDS_WRITE_TOKEN_SECRET"];
  if (readerPassword === undefined || readerPassword.length === 0) {
    if (requireReader) {
      throw new Error(
        "FEEDS_READER_PASSWORD is required when FEEDS_READER_PORT is set",
      );
    }
    return undefined;
  }
  return {
    readerUser,
    readerPassword,
    writeTokenSecret:
      writeTokenSecret !== undefined && writeTokenSecret.length > 0
        ? writeTokenSecret
        : randomBytes(32).toString("hex"),
  };
}

export type FeedsServer = {
  readonly port: number;
  readonly hostname: string | undefined;
  readonly readerPort: number | undefined;
  readonly stop: (closeActiveConnections?: boolean) => Promise<void>;
};

export type StartServerOptions = {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly shouldRefresh?: (() => Promise<boolean>) | undefined;
  readonly fetchFeed?: CreateFeedsPollerDeps["fetchFeed"] | undefined;
};

async function evaluateRefreshFlag(): Promise<boolean> {
  const evaluated = await isEnabled("feeds-refresh-enabled", {
    default: true,
    targetingKey: "feeds",
  });
  return evaluated.value;
}

function resolveShouldRefresh(
  useFlags: boolean,
  custom: (() => Promise<boolean>) | undefined,
): (() => Promise<boolean>) | undefined {
  if (custom !== undefined) return custom;
  return useFlags ? evaluateRefreshFlag : undefined;
}

async function startOptionalReaderServer(options: {
  readonly readerPort: number | undefined;
  readonly reader: ReaderCredentialsConfig | undefined;
  readonly hostname: string;
  readonly store: FeedsRepository;
  readonly poller: FeedsPoller;
  readonly metrics: FeedsMetrics;
  readonly consoleServer: ReturnType<typeof Bun.serve>;
}): Promise<ReturnType<typeof Bun.serve> | undefined> {
  const {
    readerPort,
    reader,
    hostname,
    store,
    poller,
    metrics,
    consoleServer,
  } = options;
  if (readerPort === undefined || reader === undefined) {
    return undefined;
  }
  const readerApp = createFeedsReaderApp({
    store,
    poller,
    reader,
    metrics,
  });
  let readerServer: ReturnType<typeof Bun.serve>;
  try {
    readerServer = Bun.serve({
      port: readerPort,
      hostname,
      fetch: readerApp.fetch,
    });
  } catch (error) {
    await consoleServer.stop(true);
    throw error;
  }
  if (readerServer.port === undefined) {
    await Promise.all([consoleServer.stop(true), readerServer.stop(true)]);
    throw new Error("feeds reader server did not bind a TCP port");
  }
  console.warn(`feeds reader listening on :${String(readerServer.port)}`);
  return readerServer;
}

async function shutdownOptionalFlags(useFlags: boolean): Promise<void> {
  if (useFlags) {
    await shutdownFeatureFlags();
  }
}

export async function startServer(
  port: number,
  hostname: string,
  options: StartServerOptions = {},
): Promise<FeedsServer> {
  const env = options.env ?? Bun.env;
  const readerPort = parseOptionalPort(
    env["FEEDS_READER_PORT"],
    "FEEDS_READER_PORT",
  );
  const auth = authFromEnv(env);
  const reader = readerConfigFromEnv(env, readerPort !== undefined);
  const flagsMode = env["FEATURE_FLAGS_MODE"]?.trim();
  const useFlags = flagsMode !== undefined && flagsMode !== "disabled";
  if (useFlags) {
    await initFeatureFlags({ environment: env });
  }
  const databasePath = env["FEEDS_DATABASE_PATH"] ?? ":memory:";
  const store = asyncFeedsRepository(FeedsStore.open(databasePath));
  try {
    const reconciled = await store.reconcileCatalog();
    console.warn(
      JSON.stringify({
        message: "feeds catalog reconciled",
        service: "feeds",
        upserted: reconciled.upserted,
        pruned: reconciled.pruned,
      }),
    );
    const metrics = createFeedsMetrics();
    const poller = createFeedsPoller({
      store,
      shouldRefresh: resolveShouldRefresh(useFlags, options.shouldRefresh),
      fetchFeed: options.fetchFeed,
    });
    const clientRoot = `${import.meta.dir}/../dist/client`;
    const clientReady = await Bun.file(`${clientRoot}/index.html`).exists();
    const consoleApp = createFeedsConsoleApp({
      store,
      poller,
      auth,
      reader,
      peerAddress,
      metrics,
      ...(clientReady ? { clientRoot } : {}),
    });
    const server = Bun.serve({
      port,
      hostname,
      fetch(request, bunServer) {
        peers.set(request, bunServer.requestIP(request)?.address ?? null);
        return consoleApp.fetch(request);
      },
    });
    if (server.port === undefined) {
      await server.stop(true);
      throw new Error("feeds server did not bind a TCP port");
    }

    const readerServer = await startOptionalReaderServer({
      readerPort,
      reader,
      hostname,
      store,
      poller,
      metrics,
      consoleServer: server,
    });

    console.warn(`feeds listening on :${String(server.port)}`);
    return {
      port: server.port,
      hostname: server.hostname,
      readerPort: readerServer?.port,
      async stop(closeActiveConnections?: boolean) {
        await Promise.all([
          server.stop(closeActiveConnections),
          readerServer?.stop(closeActiveConnections),
        ]);
        await store.close();
        await shutdownOptionalFlags(useFlags);
      },
    };
  } catch (error) {
    await store.close();
    await shutdownOptionalFlags(useFlags);
    throw error;
  }
}
