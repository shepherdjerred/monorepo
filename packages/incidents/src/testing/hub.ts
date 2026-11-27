/** Mounts the module the way Hub does (`/api/incidents/*`, tRPC at `/api/incidents/trpc`). */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { z } from "zod";
import type { IncidentsSettings } from "#domain/model.ts";
import { staticIncidentsFlags } from "#infrastructure/flags.ts";
import { createInMemoryIncidentsRepository } from "#infrastructure/in-memory-repository.ts";
import type { IncidentsRepository } from "#infrastructure/repository.ts";
import {
  createIncidentsHubServer,
  type IncidentsHubServer,
} from "#server/hub-server.ts";
import { TakeCommandResultSchema } from "#shared/contract.ts";
import { T0 } from "#testing/records.ts";

export const WEBHOOK_TOKEN = "webhook-token-for-tests";
export const OPS_TOKEN = "ops-ingest-token-for-tests";

export const AGENT = {
  key: "claude-code:session-a",
  kind: "agent",
  name: "claude-code",
  metadata: { branch: "feature-a", sessionId: "session-a" },
} as const;

export function agent(name: string) {
  return {
    key: `claude-code:${name}`,
    kind: "agent",
    name: "claude-code",
  } as const;
}

const TrpcResultSchema = z.object({ result: z.object({ data: z.unknown() }) });

const TrpcErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    data: z.looseObject({ code: z.string(), incident: z.unknown().optional() }),
  }),
});

export async function statusOf(
  response: Promise<Response> | Response,
): Promise<number> {
  const settled = await response;
  return settled.status;
}

export async function jsonOf(
  response: Promise<Response> | Response,
): Promise<unknown> {
  const settled = await response;
  const body: unknown = await settled.json();
  return body;
}

export type Harness = {
  readonly app: Hono;
  readonly server: IncidentsHubServer;
  readonly repository: IncidentsRepository;
  readonly clock: { now: Date };
  readonly settings: { current: Partial<IncidentsSettings> };
  readonly call: <S extends z.ZodType>(
    path: string,
    input: unknown,
    output: S,
    headers?: Record<string, string>,
  ) => Promise<z.output<S>>;
  readonly query: <S extends z.ZodType>(
    path: string,
    input: unknown,
    output: S,
  ) => Promise<z.output<S>>;
  readonly failCode: (path: string, input: unknown) => Promise<string>;
  readonly fail: (
    path: string,
    input: unknown,
    headers?: Record<string, string>,
  ) => Promise<z.output<typeof TrpcErrorSchema>["error"]>;
};

export function createHarness(
  options: {
    settings?: Partial<IncidentsSettings>;
    repository?: IncidentsRepository;
  } = {},
): Harness {
  const clock = { now: T0 };
  const repository = options.repository ?? createInMemoryIncidentsRepository();
  const base = staticIncidentsFlags(options.settings);
  const settings: { current: Partial<IncidentsSettings> } = { current: {} };
  const server = createIncidentsHubServer({
    repository,
    flags: {
      read: async () => ({ ...(await base.read()), ...settings.current }),
    },
    clock: () => clock.now,
    webhookToken: WEBHOOK_TOKEN,
    opsIngestToken: OPS_TOKEN,
    publicOrigin: "https://hub.example.ts.net",
    heartbeatMs: 20,
  });
  const app = new Hono();
  const trpc = (context: { req: { raw: Request } }) =>
    fetchRequestHandler({
      endpoint: "/api/incidents/trpc",
      req: context.req.raw,
      router: server.trpc.router,
      createContext: ({ req }) => server.trpc.createContext(req),
    });
  app.all("/api/incidents/trpc/*", trpc);
  const routes = new Hono();
  server.register(routes);
  app.route("/api/incidents", routes);

  const post = (
    path: string,
    input: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`/api/incidents/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
    });

  return {
    app,
    server,
    repository,
    clock,
    settings,
    call: async (path, input, output, headers) => {
      const response = await post(path, input, headers);
      const body: unknown = await response.json();
      if (response.status !== 200)
        throw new Error(`${path} failed: ${JSON.stringify(body)}`);
      const { result } = TrpcResultSchema.parse(body);
      return output.parse(result.data);
    },
    query: async (path, input, output) => {
      const search =
        input === undefined
          ? ""
          : `?input=${encodeURIComponent(JSON.stringify(input))}`;
      const response = await app.request(
        `/api/incidents/trpc/${path}${search}`,
      );
      const body: unknown = await response.json();
      if (response.status !== 200)
        throw new Error(`${path} failed: ${JSON.stringify(body)}`);
      const { result } = TrpcResultSchema.parse(body);
      return output.parse(result.data);
    },
    failCode: async (path, input) => {
      const response = await post(path, input);
      const body: unknown = await response.json();
      return TrpcErrorSchema.parse(body).error.data.code;
    },
    fail: async (path, input, headers) => {
      const response = await post(path, input, headers);
      const body: unknown = await response.json();
      return TrpcErrorSchema.parse(body).error;
    },
  };
}

/** Takes INC-1 as `waiter` with dispatch and returns the resulting lease. */
export async function requestDispatchLease(h: Harness) {
  const lease = await h.call(
    "take",
    { actor: agent("waiter"), ref: "INC-1", dispatch: true },
    TakeCommandResultSchema,
  );
  if (lease.outcome !== "dispatching") throw new Error("expected a lease");
  return lease;
}
