/**
 * `@shepherdjerred/incidents/hub-server`: the Hub server module. The returned
 * object is structurally a Hub `ServerModule` (`id`, `register`, `trpc`,
 * `ready`, `close`); Hub's adapter checks it with `satisfies`, so this
 * package never imports alert-dashboard.
 */
import type { Hono } from "hono";
import { INCIDENTS_MODULE_ID } from "#shared/contract.ts";
import {
  createIncidentsFlagReader,
  staticIncidentsFlags,
  type IncidentsFlagReader,
} from "#infrastructure/flags.ts";
import { createInMemoryIncidentsRepository } from "#infrastructure/in-memory-repository.ts";
import {
  createIncidentsDatabase,
  createPrismaIncidentsRepository,
} from "#infrastructure/prisma-repository.ts";
import type { IncidentsRepository } from "#infrastructure/repository.ts";
import {
  createIncidentEventBus,
  type IncidentEventBus,
} from "#server/event-bus.ts";
import { seedFixtureIncidents } from "#server/fixture-seed.ts";
import { DEFAULT_PUBLIC_ORIGIN } from "#server/read-model.ts";
import {
  incidentsRouter,
  type IncidentsContext,
  type IncidentsRouter,
} from "#server/router.ts";
import {
  DEFAULT_HEARTBEAT_MS,
  registerIncidentRoutes,
} from "#server/routes.ts";
import {
  createIncidentsService,
  type IncidentsService,
} from "#server/service.ts";
import { viewerFromRequest } from "#server/viewer.ts";

export const DEFAULT_INCIDENTS_DATABASE_URL =
  "postgres://postgres@127.0.0.1:5471/incidents";

export type IncidentsHubServerOptions = (
  | { readonly repository: IncidentsRepository }
  /** `INCIDENTS_DATABASE_URL` in Hub's environment. */
  | { readonly databaseUrl: string }
) & {
  /** Alertmanager receiver token (Hub's `WEBHOOK_TOKEN`). */
  readonly webhookToken?: string | undefined;
  /** Temporal ops-snapshot signal token (Hub's `OPS_INGEST_TOKEN`). */
  readonly opsIngestToken?: string | undefined;
  /** Origin for `url` fields; defaults to `https://hub.tailnet-1a49.ts.net`. */
  readonly publicOrigin?: string;
  /** Defaults to Hub's process-wide flag client (`alert-dashboard/prod`). */
  readonly flags?: IncidentsFlagReader;
  readonly clock?: () => Date;
  readonly heartbeatMs?: number;
};

export type IncidentsHubServer = {
  readonly id: typeof INCIDENTS_MODULE_ID;
  readonly register: (app: Hono) => void;
  readonly trpc: {
    readonly router: IncidentsRouter;
    readonly createContext: (request: Request) => IncidentsContext;
  };
  readonly ready: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  readonly service: IncidentsService;
  readonly bus: IncidentEventBus;
};

function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString("base64url");
}

export function createIncidentsHubServer(
  options: IncidentsHubServerOptions,
): IncidentsHubServer {
  const repository =
    "repository" in options
      ? options.repository
      : createPrismaIncidentsRepository(
          createIncidentsDatabase(options.databaseUrl),
        );
  const bus = createIncidentEventBus();
  const service = createIncidentsService({
    repository,
    bus,
    flags: options.flags ?? createIncidentsFlagReader(),
    publicOrigin: options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN,
    clock: options.clock ?? (() => new Date()),
    newId: () => crypto.randomUUID(),
    newToken: mintToken,
  });
  return {
    id: INCIDENTS_MODULE_ID,
    register: (app) => {
      registerIncidentRoutes(app, {
        service,
        bus,
        webhookToken: options.webhookToken,
        opsIngestToken: options.opsIngestToken,
        heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      });
    },
    trpc: {
      router: incidentsRouter,
      createContext: (request) => ({
        service,
        viewer: viewerFromRequest(request),
      }),
    },
    ready: () => service.ready(),
    close: () => service.close(),
    service,
    bus,
  };
}

const FIXTURE_LEASE_SECONDS = 6 * 60 * 60;

export type IncidentsFixtureOptions = Omit<
  IncidentsHubServerOptions,
  "repository" | "databaseUrl"
>;

/**
 * An in-memory module seeded with realistic incidents, for Hub's
 * `dev:fixture` and e2e runs: an open sev1 Delivery incident under an active
 * dispatch lease, an owned main-ci incident with a suspect, an unowned
 * observability incident past its takeover grace, a scheduled maintenance,
 * and a resolved incident. Flags default to the inventory
 * defaults (no flag client needed).
 */
export async function createIncidentsFixtureHubServer(
  options: IncidentsFixtureOptions = {},
): Promise<IncidentsHubServer> {
  const clock = options.clock ?? (() => new Date());
  const flags = options.flags ?? staticIncidentsFlags();
  let seedNow: Date | null = null;
  const server = createIncidentsHubServer({
    ...options,
    repository: createInMemoryIncidentsRepository(),
    // The seeded dispatch lease outlives a working session of UI development.
    flags: {
      read: async () => {
        const settings = await flags.read();
        return seedNow === null
          ? settings
          : { ...settings, dispatchLeaseSeconds: FIXTURE_LEASE_SECONDS };
      },
    },
    clock: () => seedNow ?? clock(),
    webhookToken: options.webhookToken ?? "fixture-webhook-token",
    opsIngestToken: options.opsIngestToken ?? "fixture-ops-ingest-token",
  });
  await seedFixtureIncidents(server.service, {
    now: clock(),
    setClock: (value) => {
      seedNow = value;
    },
  });
  seedNow = null;
  return server;
}
