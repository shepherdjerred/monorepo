import type { ObjectStore } from "#infrastructure/object-store.ts";
import type { Settings } from "#infrastructure/config.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Metrics } from "#infrastructure/metrics.ts";
import type { TokenCache } from "./token-cache.ts";

export type Caller = {
  id: string;
  key: string;
  kind: "human" | "agent" | "runner";
  name: string;
  workspaceKey: string | null;
};

export type Origins = { app: string; content: string };

export type Deps = {
  db: Database;
  store: ObjectStore;
  settings: Settings;
  origins: Origins;
  metrics: Metrics;
  tokens: TokenCache;
  now: () => Date;
};

/** Who made a change and under which request; stamped on every event. */
export type Audit = { actor: Caller; requestId: string };
