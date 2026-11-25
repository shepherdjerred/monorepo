import { randomBytes } from "node:crypto";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  createFeedsConsoleApp,
  createFeedsReaderApp,
  type ReaderCredentialsConfig,
} from "./server/app.ts";
import { authFromEnv } from "./server/auth.ts";
import { createFeedsMetrics } from "./server/metrics.ts";
import { createFeedsPoller } from "./server/poller.ts";
import { FeedsStore } from "./server/store.ts";

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
};

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
  const store = FeedsStore.open(databasePath);
  try {
    const reconciled = store.reconcileCatalog();
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
      shouldRefresh: options.shouldRefresh,
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

    let readerServer: ReturnType<typeof Bun.serve> | undefined;
    if (readerPort !== undefined && reader !== undefined) {
      const readerApp = createFeedsReaderApp({
        store,
        poller,
        reader,
        metrics,
      });
      try {
        readerServer = Bun.serve({
          port: readerPort,
          hostname,
          fetch: readerApp.fetch,
        });
      } catch (error) {
        await server.stop(true);
        throw error;
      }
      if (readerServer.port === undefined) {
        await Promise.all([server.stop(true), readerServer.stop(true)]);
        throw new Error("feeds reader server did not bind a TCP port");
      }
      console.warn(`feeds reader listening on :${String(readerServer.port)}`);
    }

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
        store.close();
        if (useFlags) {
          await shutdownFeatureFlags();
        }
      },
    };
  } catch (error) {
    store.close();
    if (useFlags) {
      await shutdownFeatureFlags();
    }
    throw error;
  }
}
