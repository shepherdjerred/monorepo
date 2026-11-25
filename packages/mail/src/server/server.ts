import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { InitFeatureFlagsOptions } from "@shepherdjerred/feature-flags";
import { createAdminApp, type TlsExpirySnapshot } from "./admin-app.ts";
import {
  initMailFeatureFlags,
  loadMailConfig,
  type EnvMap,
  type MailFeatureFlagRuntime,
  type MailServerConfig,
} from "./config.ts";
import { createHttpApiApp } from "./http-api.ts";
import { createMailMetrics, type MailMetrics } from "./metrics.ts";
import {
  RelayWorker,
  type RawMailDeliveryInput,
  type RawMailDeliveryResult,
} from "./relay.ts";
import { startSmtpServer, type RunningSmtpServer } from "./smtp-server.ts";
import { MailStore } from "./store.ts";
import { TlsCertificateLoader } from "./tls-loader.ts";

const DEFAULT_CLIENT_ROOT = path.resolve(import.meta.dir, "../../dist/client");

export type StartMailServerOptions = {
  readonly env?: EnvMap;
  readonly clientRoot?: string;
  readonly flagProvider?: InitFeatureFlagsOptions["provider"];
  readonly sendRawMail?: (
    input: RawMailDeliveryInput,
  ) => Promise<RawMailDeliveryResult>;
};

export type RunningMailServer = {
  readonly port: number;
  readonly hostname: string | undefined;
  readonly apiPort: number | undefined;
  readonly smtpPort: number | undefined;
  readonly store: MailStore;
  readonly relay: RelayWorker;
  readonly metrics: MailMetrics;
  readonly stop: (closeActiveConnections?: boolean) => Promise<void>;
};

function createOptionalTlsLoader(
  config: MailServerConfig,
): TlsCertificateLoader | undefined {
  if (
    config.smtpTlsCertPath === undefined ||
    config.smtpTlsKeyPath === undefined
  ) {
    return undefined;
  }
  return new TlsCertificateLoader({
    certPath: config.smtpTlsCertPath,
    keyPath: config.smtpTlsKeyPath,
  });
}

async function readTlsExpiry(
  tlsLoader: TlsCertificateLoader | undefined,
): Promise<TlsExpirySnapshot | null> {
  if (tlsLoader === undefined) {
    return null;
  }
  try {
    const material = await tlsLoader.load();
    return {
      iso: material.expiresAtIso,
      epochSeconds: material.expiresAtEpochSeconds,
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        service: "mail",
        message: "mail_tls_cert_inspect_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

function createRelayWorker(
  config: MailServerConfig,
  store: MailStore,
  flags: MailFeatureFlagRuntime,
  deps: {
    readonly metrics: MailMetrics;
    readonly sendRawMail: StartMailServerOptions["sendRawMail"];
  },
): RelayWorker {
  return new RelayWorker({
    store,
    fastmailHost: config.fastmailHost,
    fastmailPort: config.fastmailPort,
    ...(config.fastmailUsername === undefined
      ? {}
      : { fastmailUsername: config.fastmailUsername }),
    ...(config.fastmailPassword === undefined
      ? {}
      : { fastmailPassword: config.fastmailPassword }),
    fastmailRequireTls: config.fastmailRequireTls,
    isRelayEnabled: flags.isRelayEnabled,
    metrics: deps.metrics,
    ...(deps.sendRawMail === undefined
      ? {}
      : { sendRawMail: deps.sendRawMail }),
  });
}

function startOptionalApiServer(
  config: MailServerConfig,
  store: MailStore,
  flags: MailFeatureFlagRuntime,
  deps: { readonly relay: RelayWorker; readonly metrics: MailMetrics },
): ReturnType<typeof Bun.serve> | undefined {
  if (config.apiPort === undefined) {
    return undefined;
  }
  const apiApp = createHttpApiApp({
    store,
    clients: config.clients,
    getSettings: flags.getSettings,
    onMessageQueued: () => {
      deps.relay.notify();
    },
    metrics: deps.metrics,
  });
  const apiServer = Bun.serve({
    port: config.apiPort,
    hostname: config.host,
    fetch: apiApp.fetch,
  });
  if (apiServer.port === undefined) {
    void apiServer.stop(true);
    throw new Error("mail HTTP API server did not bind a TCP port");
  }
  console.warn(`mail HTTP API listening on :${String(apiServer.port)}`);
  return apiServer;
}

export async function startMailServer(
  options: StartMailServerOptions = {},
): Promise<RunningMailServer> {
  const env = options.env ?? Bun.env;
  const config = loadMailConfig(env);
  const metrics = createMailMetrics({ collectDefaults: true });
  const flags = await initMailFeatureFlags({
    config,
    env,
    metrics: metrics.featureFlags,
    ...(options.flagProvider === undefined
      ? {}
      : { provider: options.flagProvider }),
  });

  if (config.databasePath !== ":memory:") {
    await mkdir(path.dirname(config.databasePath), { recursive: true });
  }

  const initialSettings = await flags.getSettings();
  const store = MailStore.open(config.databasePath, {
    retentionDays: initialSettings.retentionDays,
  });

  const tlsLoader = createOptionalTlsLoader(config);
  const relay = createRelayWorker(config, store, flags, {
    metrics,
    sendRawMail: options.sendRawMail,
  });

  const httpServers: ReturnType<typeof Bun.serve>[] = [];
  let smtpServer: RunningSmtpServer | undefined;

  try {
    if (config.smtpPort !== undefined) {
      smtpServer = startSmtpServer({
        hostname: config.host,
        port: config.smtpPort,
        smtpHostname: config.smtpHostname,
        store,
        clients: config.clients,
        ...(tlsLoader === undefined ? {} : { tlsLoader }),
        getSettings: flags.getSettings,
        onMessageQueued: () => {
          relay.notify();
        },
        metrics,
      });
      console.warn(
        `mail smtp submission listening on :${String(smtpServer.port)}`,
      );
    }

    const apiServer = startOptionalApiServer(config, store, flags, {
      relay,
      metrics,
    });
    if (apiServer !== undefined) {
      httpServers.push(apiServer);
    }

    const candidateClientRoot = options.clientRoot ?? DEFAULT_CLIENT_ROOT;
    const clientReady = await Bun.file(
      path.join(candidateClientRoot, "index.html"),
    ).exists();

    const adminApp = createAdminApp({
      store,
      upstreamHost: config.fastmailHost,
      upstreamPort: config.fastmailPort,
      smtpListenerPort: smtpServer?.port ?? null,
      ...(smtpServer === undefined
        ? {}
        : { isSmtpReady: () => smtpServer?.isListening() ?? false }),
      getSmtpTlsCertExpiry: () => readTlsExpiry(tlsLoader),
      isRelayEnabled: flags.isRelayEnabled,
      getSettings: flags.getSettings,
      configuredClientIds: Object.keys(config.clients),
      onMessageQueued: () => {
        relay.notify();
      },
      metrics,
      ...(clientReady ? { clientRoot: candidateClientRoot } : {}),
    });

    const adminServer = Bun.serve({
      port: config.port,
      hostname: config.host,
      fetch: adminApp.fetch,
    });
    httpServers.push(adminServer);
    if (adminServer.port === undefined) {
      throw new Error("mail admin server did not bind a TCP port");
    }

    relay.start();
    relay.notify();
    console.warn(`mail admin listening on :${String(adminServer.port)}`);

    return {
      port: adminServer.port,
      hostname: adminServer.hostname,
      apiPort: apiServer?.port,
      smtpPort: smtpServer?.port,
      store,
      relay,
      metrics,
      async stop(closeActiveConnections = true) {
        smtpServer?.stop(closeActiveConnections);
        await Promise.all(
          httpServers.map((srv) => srv.stop(closeActiveConnections)),
        );
        await relay.stop();
        await flags.shutdown();
        store.close();
      },
    };
  } catch (error) {
    smtpServer?.stop(true);
    await Promise.all(httpServers.map((srv) => srv.stop(true)));
    await relay.stop();
    await flags.shutdown();
    store.close();
    throw error;
  }
}
