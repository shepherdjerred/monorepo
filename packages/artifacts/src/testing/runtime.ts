import type {
  CatalogFile,
  CatalogVersion,
  ContentCatalog,
} from "#application/content-catalog.ts";
import { createChangeHub } from "#infrastructure/change-hub.ts";
import { behaviorConfig } from "#infrastructure/config.ts";
import { createDatabase, type Database } from "#infrastructure/database.ts";
import { createRuntime, type Runtime } from "#server/runtime.ts";
import {
  memoryObjectStore,
  type MemoryObjectStore,
} from "./memory-object-store.ts";

export const LOGIN = "operator@example.test";
export const APP_ORIGIN = "https://app.example.test";
export const CONTENT_ORIGIN = "https://content.example.test";
export const INTERNAL_HOST = "artifacts.artifacts.svc.cluster.local:7440";

/** A database URL nothing listens on: unit tests never reach a query. */
export const UNREACHABLE_DATABASE = "postgres://artifacts@127.0.0.1:1/none";

export type HostName = "app" | "content" | "internal";

export function hostHeader(host: HostName): string {
  return host === "app"
    ? new URL(APP_ORIGIN).host
    : host === "content"
      ? new URL(CONTENT_ORIGIN).host
      : INTERNAL_HOST;
}

export type CallInit = {
  method?: string;
  headers?: Record<string, string>;
  /** Defaults to the operator login; null sends none. */
  login?: string | null;
  body?: BodyInit;
};

export type TestRuntime = Runtime & {
  store: MemoryObjectStore;
  catalog: MemoryCatalog;
  call: (host: HostName, path: string, init?: CallInit) => Promise<Response>;
};

export type MemoryCatalog = ContentCatalog & {
  addVersion: (
    token: string,
    version: CatalogVersion,
    files: Record<string, CatalogFile>,
  ) => void;
  removeToken: (token: string) => void;
};

export function memoryCatalog(): MemoryCatalog {
  const versions = new Map<string, CatalogVersion>();
  const files = new Map<string, CatalogFile>();
  return {
    findVersion: (token) => Promise.resolve(versions.get(token) ?? null),
    findFile: (versionId, path) =>
      Promise.resolve(files.get(`${versionId}\0${path}`) ?? null),
    addVersion(token, version, entries) {
      versions.set(token, version);
      for (const [path, file] of Object.entries(entries))
        files.set(`${version.versionId}\0${path}`, file);
    },
    removeToken: (token) => versions.delete(token),
  };
}

export type TestRuntimeOptions = {
  db?: Database;
  flagValues?: Record<string, unknown>;
  clientRoot?: string;
  heartbeatMs?: number;
  logins?: string;
};

/** The whole service over in-memory ports; a real database is optional. */
export async function createTestRuntime(
  options: TestRuntimeOptions = {},
): Promise<TestRuntime> {
  const store = memoryObjectStore();
  const catalog = memoryCatalog();
  const db = options.db ?? createDatabase(UNREACHABLE_DATABASE);
  const settings = behaviorConfig("test", {
    flagValues: options.flagValues ?? {},
    environment: { ARTIFACTS_OPERATOR_LOGINS: options.logins ?? LOGIN },
  });
  const runtime = await createRuntime({
    db,
    store,
    settings,
    hub: createChangeHub(UNREACHABLE_DATABASE),
    appOrigin: APP_ORIGIN,
    contentOrigin: CONTENT_ORIGIN,
    catalog,
    ...(options.clientRoot === undefined
      ? {}
      : { clientRoot: options.clientRoot }),
    ...(options.heartbeatMs === undefined
      ? {}
      : { heartbeatMs: options.heartbeatMs }),
  });
  const call = async (host: HostName, path: string, init: CallInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("host", hostHeader(host));
    const login = init.login === undefined ? LOGIN : init.login;
    if (login !== null) headers.set("Tailscale-User-Login", login);
    const origin = host === "app" ? APP_ORIGIN : CONTENT_ORIGIN;
    return runtime.fetch(
      new Request(`${origin}${path}`, {
        method: init.method ?? "GET",
        headers,
        ...(init.body === undefined ? {} : { body: init.body }),
      }),
    );
  };
  return { ...runtime, store, catalog, call };
}
