import {
  CLIENT_ACTION_REQUEST_SCHEMAS,
  type ClientStartRequest,
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
import { guarded } from "./live-routes.ts";
import type { LiveService } from "#src/live/service.ts";
import { CaptureBoundedActionSchema } from "#protocol/capture.ts";

/** The slice of the daemon context the client routes use. */
type ClientRouteContext = {
  provider: Pick<SandboxBackend, "list">;
  clients: ClientManager;
  live?: LiveService;
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
  return start.target === "live"
    ? startLiveClient(ctx, request, start)
    : startSandboxClient(ctx, start);
}

async function boundedAction(
  ctx: ClientRouteContext,
  request: Request,
  client: string,
): Promise<Response> {
  const operation = await body(request, CaptureBoundedActionSchema);
  const { client: summary, state } = await ctx.clients.status(client);
  if (!state.connected) throw new DaemonError("Client is disconnected", 409);
  const target = await ctx.target(summary.target);
  const { worlds } = await target.bridge.info();
  const world = worlds.find((entry) => entry.name === operation.box.world);
  if (world?.key !== state.world)
    throw new DaemonError("Client is outside the declared fixture world", 409);
  if (state.target.kind === "block") {
    const position = state.target["position"];
    const minimum = [
      operation.box.min.x,
      operation.box.min.y,
      operation.box.min.z,
    ];
    const maximum = [
      operation.box.max.x,
      operation.box.max.y,
      operation.box.max.z,
    ];
    if (
      !Array.isArray(position) ||
      position.length !== 3 ||
      !position.every(
        (value, axis) =>
          typeof value === "number" &&
          value >= (minimum[axis] ?? Infinity) &&
          value <= (maximum[axis] ?? -Infinity),
      )
    )
      throw new DaemonError("Crosshair is outside the declared fixture", 409);
  } else if (
    operation.action !== "click" &&
    operation.action !== "sign-write" &&
    operation.action !== "screen-activate"
  )
    throw new DaemonError("Aim at the declared fixture", 409);
  const act = () =>
    ctx.clients.request(client, operation.action, operation.arguments);
  if (summary.target === "live") {
    if (ctx.live === undefined)
      throw new DaemonError("Live service unavailable", 503);
    const { players } = await target.bridge.players();
    const participant = players.find(
      (player) => player.name === client && player.uuid === state["uuid"],
    );
    if (participant === undefined)
      throw new DaemonError(
        "Live player identity differs from the controlled client",
        409,
      );
    const result = await guarded(
      { target, request, ctx: { live: ctx.live, clients: ctx.clients } },
      () =>
        Promise.resolve({
          kind: "client-act",
          name: client,
          uuid: participant.uuid,
          action: operation.action,
          box: operation.box,
        }),
      act,
    );
    return Response.json({ result });
  }
  return Response.json({ result: await act() });
}

async function startLiveClient(
  ctx: ClientRouteContext,
  request: Request,
  start: ClientStartRequest,
): Promise<Response> {
  if (start.name !== "XiguaJerred" || start.op || start.gameMode !== undefined)
    throw new DaemonError(
      "Live capture uses XiguaJerred without automatic op or game-mode changes",
    );
  if (ctx.live === undefined)
    throw new DaemonError("Live service unavailable", 503);
  const target = await ctx.target("live");
  const existing = ctx.clients
    .list()
    .find((client) => client.name === start.name && client.target === "live");
  const { players } = await target.bridge.players();
  if (
    existing === undefined &&
    players.some((player) => player.name === start.name)
  )
    throw new DaemonError(
      "XiguaJerred is already connected; refusing to replace that session",
      409,
    );
  const summary = await guarded(
    { target, request, ctx: { live: ctx.live, clients: ctx.clients } },
    () =>
      Promise.resolve({ kind: "command", command: "capture-session-start" }),
    () =>
      ctx.clients.start({
        name: start.name,
        target: "live",
        game: { host: "mc.ts-mc.net", port: 30_000 },
      }),
  );
  return reply(
    ClientStatusResponseSchema,
    await ctx.clients.status(summary.name),
  );
}

async function startSandboxClient(
  ctx: ClientRouteContext,
  start: ClientStartRequest,
): Promise<Response> {
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
  if (action === "bounded") return boundedAction(ctx, request, client);
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
  const { client: summary, state } = await ctx.clients.status(client);
  let result: unknown;
  if (
    summary.target === "live" &&
    ![
      "release",
      "release-inputs",
      "close",
      "messages",
      "screen-inspect",
      "record-status",
      "record-cancel",
    ].includes(action)
  ) {
    if (ctx.live === undefined)
      throw new DaemonError("Live service unavailable", 503);
    const target = await ctx.target("live");
    if (
      ["use", "attack", "click", "sign-write", "screen-activate"].includes(
        action,
      ) ||
      (action === "move" &&
        "buttons" in args &&
        args.buttons.some((button) => button === "use" || button === "attack"))
    )
      throw new DaemonError(
        "Live block interactions require a bounded capture scene",
        409,
      );
    if (!state.connected)
      throw new DaemonError("Live client is disconnected", 409);
    result = await guarded(
      { target, request, ctx: { live: ctx.live, clients: ctx.clients } },
      () =>
        Promise.resolve({
          kind: "command",
          command:
            action === "command" && "text" in args
              ? args.text
              : `capture-client-${action}`,
        }),
      () => ctx.clients.request(client, wire, args),
    );
  } else result = await ctx.clients.request(client, wire, args);
  return reply(ClientActionResponseSchema, { detail: detail(result), result });
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
