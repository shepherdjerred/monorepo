import {
  createContentCatalog,
  type ContentCatalog,
} from "#application/content-catalog.ts";
import { createServices, type Services } from "#application/services.ts";
import { createTokenCache } from "#application/token-cache.ts";
import type { ChangeHub } from "#infrastructure/change-hub.ts";
import type { Settings } from "#infrastructure/config.ts";
import type { Database } from "#infrastructure/database.ts";
import { createMetrics } from "#infrastructure/metrics.ts";
import {
  meterObjectStore,
  type ObjectStore,
} from "#infrastructure/object-store.ts";
import { createAppHandler } from "./app-host.ts";
import { databaseReady } from "./health.ts";
import {
  buildBridge,
  createViewerAssets,
  type BridgeAssets,
  type ViewerAssets,
} from "./assets.ts";
import { createContentHandler } from "./content-host.ts";
import { hostOf, routeByHost } from "./host-router.ts";
import { createInternalHandler } from "./internal-host.ts";
import type { StreamStats } from "./streams.ts";

export type RuntimeInput = {
  db: Database;
  store: ObjectStore;
  settings: Settings;
  hub: ChangeHub;
  appOrigin: string;
  contentOrigin: string;
  clientRoot?: string;
  heartbeatMs?: number;
  /** Replaces the database-backed catalog, for tests of the content host. */
  catalog?: ContentCatalog;
  bridge?: BridgeAssets;
  viewer?: ViewerAssets;
  now?: () => Date;
};

export type Runtime = {
  fetch: (request: Request) => Promise<Response> | Response;
  services: Services;
  stats: StreamStats;
};

/** Wires the use cases and the three host classes into one `fetch`. */
export async function createRuntime(input: RuntimeInput): Promise<Runtime> {
  const metrics = createMetrics();
  const store = meterObjectStore(input.store, metrics);
  const tokens = createTokenCache();
  const services = createServices({
    db: input.db,
    store,
    settings: input.settings,
    origins: { app: input.appOrigin, content: input.contentOrigin },
    metrics,
    tokens,
    now: input.now ?? (() => new Date()),
  });
  const stats: StreamStats = { feedback: 0, events: 0 };
  const operatorLogins = () => input.settings.value("operatorLogins");
  const bridge = input.bridge ?? (await buildBridge(input.appOrigin));
  const app = createAppHandler({
    services,
    store,
    hub: input.hub,
    stats,
    metrics,
    origins: { app: input.appOrigin, content: input.contentOrigin },
    operatorLogins,
    ...(input.clientRoot === undefined ? {} : { clientRoot: input.clientRoot }),
    ...(input.heartbeatMs === undefined
      ? {}
      : { heartbeatMs: input.heartbeatMs }),
  });
  const content = createContentHandler({
    catalog: input.catalog ?? createContentCatalog(input.db),
    store,
    tokens,
    origins: { appOrigin: input.appOrigin, contentOrigin: input.contentOrigin },
    bridge,
    viewer: input.viewer ?? createViewerAssets(),
    metrics,
    operatorLogins,
    ready: databaseReady(input.db),
  });
  const internal = createInternalHandler({
    services,
    hub: input.hub,
    stats,
    metrics,
  });
  return {
    fetch: routeByHost({
      appHost: hostOf(input.appOrigin),
      contentHost: hostOf(input.contentOrigin),
      app,
      content,
      internal,
    }),
    services,
    stats,
  };
}
