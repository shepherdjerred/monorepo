import {
  CLIENT_ACTION_REQUEST_SCHEMAS,
  ClientActionResponseSchema,
  ClientActionSchema,
  ClientCaptureRequestSchema,
  ClientCaptureResponseSchema,
  ClientListResponseSchema,
  ClientNameSchema,
  ClientStartRequestSchema,
  ClientStatusResponseSchema,
  ClientStopResponseSchema,
} from "#protocol/client.ts";
import type { SandboxBackend } from "#sandbox/provider.ts";
import type { Target } from "#src/target.ts";
import type { ClientManager } from "./clients.ts";
import { body, DaemonError, reply } from "./http.ts";

/** The slice of the daemon context the client routes use. */
type ClientRouteContext = {
  provider: Pick<SandboxBackend, "list">;
  clients: ClientManager;
  target: (id: string) => Promise<Target>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

function detail(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

async function startClient(
  ctx: ClientRouteContext,
  request: Request,
): Promise<Response> {
  const start = await body(request, ClientStartRequestSchema);
  const records = await ctx.provider.list();
  const record = records.find((candidate) => candidate.id === start.target);
  if (record === undefined) {
    throw new DaemonError(`No sandbox ${start.target}`, 404);
  }
  if (record.status !== "ready") {
    throw new DaemonError(`Sandbox ${start.target} is ${record.status}`, 409);
  }
  const summary = await ctx.clients.start({
    name: start.name,
    target: record.id,
    game: record.endpoints.game,
  });
  // Ops and game mode go through the bridge console, as for actors.
  const target = await ctx.target(record.id);
  if (start.op) {
    await target.bridge.command(`op ${start.name}`);
  }
  if (start.gameMode !== undefined) {
    await target.bridge.command(
      `gamemode ${start.gameMode.toLowerCase()} ${start.name}`,
    );
  }
  const { state } = await ctx.clients.status(summary.name);
  return reply(ClientStatusResponseSchema, { client: summary, state });
}

/** POST /clients/:name/:action — `move` is the client protocol's `input`. */
async function clientAction(
  ctx: ClientRouteContext,
  request: Request,
  client: string,
  action: string,
): Promise<Response> {
  if (action === "capture") {
    const { out } = await body(request, ClientCaptureRequestSchema);
    return reply(ClientCaptureResponseSchema, {
      path: await ctx.clients.capture(client, out),
    });
  }
  const parsed = ClientActionSchema.safeParse(action);
  if (!parsed.success) {
    throw new DaemonError(`Unknown client action ${action}`, 404);
  }
  const args = await body(request, CLIENT_ACTION_REQUEST_SCHEMAS[parsed.data]);
  const wire = parsed.data === "move" ? "input" : parsed.data;
  const result = await ctx.clients.request(client, wire, args);
  return reply(ClientActionResponseSchema, { detail: detail(result) });
}

async function clientRoute(
  ctx: ClientRouteContext,
  request: Request,
  name: string,
  action: string | undefined,
): Promise<Response> {
  const parsed = ClientNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new DaemonError(`Invalid client name ${name}`);
  }
  const client = parsed.data;
  if (action !== undefined && request.method === "POST") {
    return clientAction(ctx, request, client, action);
  }
  if (action === undefined && request.method === "GET") {
    return reply(ClientStatusResponseSchema, await ctx.clients.status(client));
  }
  if (action === undefined && request.method === "DELETE") {
    await ctx.clients.stop(client);
    ctx.log("client stopped", { name: client });
    return reply(ClientStopResponseSchema, { stopped: [client] });
  }
  throw new DaemonError(
    `Unknown route ${request.method} /clients/${client}${action === undefined ? "" : `/${action}`}`,
    404,
  );
}

/** `/clients[/:name[/:action]]`. */
export async function dispatchClients(
  ctx: ClientRouteContext,
  request: Request,
  name: string | undefined,
  action: string | undefined,
): Promise<Response> {
  if (name !== undefined) {
    return clientRoute(ctx, request, name, action);
  }
  if (request.method === "GET") {
    return reply(ClientListResponseSchema, { clients: ctx.clients.list() });
  }
  if (request.method === "POST") {
    return startClient(ctx, request);
  }
  throw new DaemonError(`Unknown route ${request.method} /clients`, 404);
}
