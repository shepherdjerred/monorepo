import { z } from "zod";
import { BridgeRequestError } from "#bridge/client.ts";
import {
  ACTOR_ACTIONS,
  type ActorAction,
  ActorActionRequestSchemas,
  ActorActionResponseSchema,
  ActorListResponseSchema,
  ActorNameSchema,
  ActorObservationSchema,
  ActorRemoveResponseSchema,
  ActorSchema,
  ActorSpawnRequestSchema,
  BoxSchema,
  CommandRequestSchema,
  CommandResponseSchema,
  EventsResponseSchema,
  InfoResponseSchema,
  PlayersResponseSchema,
  RegionReadResponseSchema,
  RegistryResponseSchema,
  SnapshotCreateRequestSchema,
  SnapshotListResponseSchema,
  SnapshotRestoreResponseSchema,
  SnapshotSchema,
  WePasteRequestSchema,
  WePasteResponseSchema,
  WeRunRequestSchema,
  WeRunResponseSchema,
  WeUndoRequestSchema,
  WeUndoResponseSchema,
} from "#protocol/bridge.ts";
import {
  LogsResponseSchema,
  SandboxCreateRequestSchema,
  SandboxDownResponseSchema,
  SandboxIdSchema,
  SandboxListResponseSchema,
  SandboxSummarySchema,
  SnapshotBytesResponseSchema,
  StatusResponseSchema,
} from "#protocol/ipc.ts";
import {
  PlaytestListResponseSchema,
  PlaytestReportSchema,
  PlaytestRunRequestSchema,
  PlaytestRunResponseSchema,
  RunIdSchema,
} from "#protocol/playtest.ts";
import { PROTOCOL_VERSION } from "#protocol/version.ts";
import { LIVE_TARGET_ID } from "#protocol/live.ts";
import { listRuns, readRun, runPlaytests } from "#daemon/playtests.ts";
import type { SandboxBackend } from "#sandbox/provider.ts";
import { toSummary } from "#sandbox/record.ts";
import { pasteBox } from "#src/live/paste-box.ts";
import type { LiveService } from "#src/live/service.ts";
import type { Target } from "#src/target.ts";
import { dispatchClients } from "./client-routes.ts";
import type { ClientManager } from "./clients.ts";
import { body, DaemonError, reply } from "./http.ts";
import {
  dispatchLive,
  guarded,
  liveErrorResponse,
  snapshotBox,
} from "./live-routes.ts";

export type DaemonContext = {
  provider: SandboxBackend;
  /** Live minecraft-tsmc (`--target live`). */
  live: LiveService;
  /** Resolves a ready sandbox to a target; throws DaemonError(404) otherwise. */
  target: (id: string) => Promise<Target>;
  /** Real Minecraft clients joined to sandboxes (`toolkit mc client`). */
  clients: ClientManager;
  startedAt: string;
  ttlSeconds: number;
  repoRoot: string;
  lastActivity: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

const SnapshotRestoreBodySchema = z.strictObject({ id: z.string().min(1) });

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) {
    return fallback;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new DaemonError(`${name} must be a non-negative integer`);
  }
  return Number(raw);
}

type TargetCall = {
  ctx: DaemonContext;
  url: URL;
  request: Request;
  target: Target;
  action: string;
};

async function targetGet(call: TargetCall): Promise<Response | null> {
  const { url, target, action } = call;
  const { bridge } = target;
  switch (action) {
    case "info": {
      return reply(InfoResponseSchema, await bridge.info());
    }
    case "players": {
      return reply(PlayersResponseSchema, await bridge.players());
    }
    case "events": {
      return reply(
        EventsResponseSchema,
        await bridge.events(
          intParam(url, "since", 0),
          intParam(url, "limit", 200),
        ),
      );
    }
    case "logs": {
      return reply(LogsResponseSchema, {
        lines: await target.logs.tail(intParam(url, "lines", 200)),
      });
    }
    case "snapshots": {
      return reply(SnapshotListResponseSchema, await bridge.snapshotList());
    }
    case "registry": {
      return reply(RegistryResponseSchema, await bridge.registry());
    }
  }
  if (action === "actors") {
    return reply(ActorListResponseSchema, await bridge.actorList());
  }
  const actor = actorPath(action);
  if (actor !== null && actor.act === undefined) {
    return reply(ActorObservationSchema, await bridge.actorObserve(actor.name));
  }
  if (action.startsWith("snapshots/")) {
    const sid = action.slice("snapshots/".length);
    const bytes = await bridge.snapshotBytes(sid);
    return reply(SnapshotBytesResponseSchema, {
      id: sid,
      base64: Buffer.from(bytes).toString("base64"),
    });
  }
  return null;
}

async function targetPost(call: TargetCall): Promise<Response | null> {
  const { ctx, request, target, action } = call;
  const { bridge, id } = target;
  switch (action) {
    case "command": {
      const { command } = await body(request, CommandRequestSchema);
      ctx.log("command", { target: id, command });
      return reply(
        CommandResponseSchema,
        await guarded(
          call,
          () => Promise.resolve({ kind: "command", command }),
          (live) => live.bridge.command(command),
        ),
      );
    }
    case "we": {
      const run = await body(request, WeRunRequestSchema);
      ctx.log("we", {
        target: id,
        world: run.world,
        commands: run.ops.map((op) => op.command),
      });
      return reply(
        WeRunResponseSchema,
        await guarded(
          call,
          () => Promise.resolve({ kind: "we", world: run.world, ops: run.ops }),
          (live) => live.bridge.weRun(run),
        ),
      );
    }
    case "paste": {
      const paste = await body(request, WePasteRequestSchema);
      ctx.log("paste", { target: id, world: paste.world, at: paste.at });
      return reply(
        WePasteResponseSchema,
        await guarded(
          call,
          async () => ({
            kind: "paste",
            world: paste.world,
            box: await pasteBox(
              paste.world,
              paste.at,
              paste.rotate,
              paste.schematic,
            ),
          }),
          (live) => live.bridge.wePaste(paste),
        ),
      );
    }
    case "undo": {
      const undo = await body(request, WeUndoRequestSchema);
      return reply(
        WeUndoResponseSchema,
        await guarded(
          call,
          () => Promise.resolve({ kind: "we-undo", steps: undo.steps }),
          (live) => live.bridge.weUndo(undo),
        ),
      );
    }
    case "region-read": {
      const box = await body(request, BoxSchema);
      return reply(RegionReadResponseSchema, await bridge.regionRead(box));
    }
    case "snapshot": {
      const create = await body(request, SnapshotCreateRequestSchema);
      return reply(
        SnapshotSchema,
        await bridge.snapshotCreate(create.box, create.label),
      );
    }
    case "snapshot-restore": {
      const { id: sid } = await body(request, SnapshotRestoreBodySchema);
      ctx.log("snapshot-restore", { target: id, snapshot: sid });
      return reply(
        SnapshotRestoreResponseSchema,
        await guarded(
          call,
          async () => ({
            kind: "snapshot-restore",
            snapshotId: sid,
            box: await snapshotBox(target, sid),
          }),
          (live) => live.bridge.snapshotRestore(sid),
        ),
      );
    }
    case "actors": {
      const spawn = await body(request, ActorSpawnRequestSchema);
      ctx.log("actor spawn", { target: id, actor: spawn.name });
      return reply(
        ActorSchema,
        await guarded(
          call,
          () =>
            Promise.resolve({
              kind: "actor-spawn",
              name: spawn.name,
              world: spawn.world,
            }),
          (live) => live.bridge.actorSpawn(spawn),
        ),
      );
    }
  }
  const actor = actorPath(action);
  if (actor?.act !== undefined) {
    const act = actor.act;
    const parsed = await body(request, ActorActionRequestSchemas[act]);
    ctx.log("actor act", { target: id, actor: actor.name, action: act });
    return reply(
      ActorActionResponseSchema,
      await guarded(
        call,
        async () => ({
          kind: "actor-act",
          name: actor.name,
          act,
          pos: "pos" in parsed ? parsed.pos : undefined,
          command: "command" in parsed ? parsed.command : undefined,
          world: BLOCK_ACTIONS.has(act)
            ? await actorWorld(target, actor.name)
            : undefined,
        }),
        (live) => live.bridge.actorAct(actor.name, act, parsed),
      ),
    );
  }
  return null;
}

/** Actor actions that change blocks; the guard needs the actor's world. */
const BLOCK_ACTIONS: ReadonlySet<string> = new Set(["break", "place", "use"]);

async function actorWorld(target: Target, name: string): Promise<string> {
  const observation = await target.bridge.actorObserve(name);
  return observation.actor.world;
}

async function targetDelete(call: TargetCall): Promise<Response | null> {
  const actor = actorPath(call.action);
  if (actor === null || actor.act !== undefined) {
    return null;
  }
  call.ctx.log("actor remove", { target: call.target.id, actor: actor.name });
  return reply(
    ActorRemoveResponseSchema,
    await guarded(
      call,
      () => Promise.resolve({ kind: "actor-remove", name: actor.name }),
      (live) => live.bridge.actorRemove(actor.name),
    ),
  );
}

/** `actors/<name>` or `actors/<name>/<action>`; null for any other path. */
export function actorPath(
  action: string,
): { name: string; act: ActorAction | undefined } | null {
  const [root, name, act, ...extra] = action.split("/");
  if (root !== "actors" || name === undefined || extra.length > 0) {
    return null;
  }
  if (!ActorNameSchema.safeParse(name).success) {
    throw new DaemonError(`Invalid actor name ${name}`);
  }
  if (act === undefined) {
    return { name, act: undefined };
  }
  const known = ACTOR_ACTIONS.find((candidate) => candidate === act);
  if (known === undefined) {
    throw new DaemonError(
      `Unknown actor action ${act}; use one of ${ACTOR_ACTIONS.join(", ")}`,
      404,
    );
  }
  return { name, act: known };
}

async function dispatchTarget(
  ctx: DaemonContext,
  url: URL,
  request: Request,
  path: { id: string; action: string },
): Promise<Response> {
  const call: TargetCall = {
    ctx,
    url,
    request,
    target: await ctx.target(path.id),
    action: path.action,
  };
  const handlers: Record<
    string,
    (call: TargetCall) => Promise<Response | null>
  > = { GET: targetGet, POST: targetPost, DELETE: targetDelete };
  const handler = handlers[request.method] ?? null;
  const response = handler === null ? null : await handler(call);
  if (response === null) {
    throw new DaemonError(
      `Unknown route ${request.method} /targets/${path.id}/${path.action}`,
      404,
    );
  }
  return response;
}

async function dispatchSandboxes(
  ctx: DaemonContext,
  request: Request,
  id: string | undefined,
): Promise<Response> {
  if (id === undefined && request.method === "GET") {
    const sandboxes = await ctx.provider.list();
    return reply(SandboxListResponseSchema, {
      sandboxes: sandboxes.map((record) => toSummary(record)),
    });
  }
  if (id === undefined && request.method === "POST") {
    const create = await body(request, SandboxCreateRequestSchema);
    await ctx.provider.reap(new Date());
    const record = await ctx.provider.create(create, (message) => {
      ctx.log("sandbox progress", { message });
    });
    ctx.log("sandbox ready", { id: record.id, bootMs: record.bootMs });
    return reply(SandboxSummarySchema, toSummary(record));
  }
  if (id !== undefined && request.method === "DELETE") {
    const parsed = SandboxIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new DaemonError(`Invalid sandbox id ${id}`);
    }
    await ctx.clients.stopForTarget(parsed.data);
    await ctx.provider.destroy(parsed.data);
    ctx.log("sandbox removed", { id: parsed.data });
    return reply(SandboxDownResponseSchema, { removed: [parsed.data] });
  }
  throw new DaemonError(`Unknown route ${request.method} /sandboxes`, 404);
}

async function dispatchPlaytests(
  ctx: DaemonContext,
  request: Request,
  runId: string | undefined,
): Promise<Response> {
  if (runId === undefined && request.method === "POST") {
    const run = await body(request, PlaytestRunRequestSchema);
    ctx.log("playtest run", { files: run.files, target: run.target });
    return reply(PlaytestRunResponseSchema, await runPlaytests(ctx, run));
  }
  if (runId === undefined && request.method === "GET") {
    const reports = await listRuns();
    return reply(PlaytestListResponseSchema, {
      runs: reports.map((report) => ({
        runId: report.runId,
        scenario: report.scenario.name,
        status: report.status,
        startedAt: report.startedAt,
        durationMs: report.durationMs,
      })),
    });
  }
  if (runId !== undefined && request.method === "GET") {
    const parsed = RunIdSchema.safeParse(runId);
    if (!parsed.success) {
      throw new DaemonError(`Invalid run id ${runId}`);
    }
    return reply(PlaytestReportSchema, await readRun(parsed.data));
  }
  throw new DaemonError(`Unknown route ${request.method} /playtests`, 404);
}

async function statusResponse(ctx: DaemonContext): Promise<Response> {
  const sandboxes = await ctx.provider.list();
  return reply(StatusResponseSchema, {
    pid: process.pid,
    startedAt: ctx.startedAt,
    ttlSeconds: ctx.ttlSeconds,
    idleSeconds: Math.floor((Date.now() - ctx.lastActivity) / 1000),
    protocolVersion: PROTOCOL_VERSION,
    repoRoot: ctx.repoRoot,
    sandboxes: sandboxes.length,
  });
}

async function dispatch(
  ctx: DaemonContext,
  url: URL,
  request: Request,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);
  const [root, id, ...rest] = parts;
  if (root === "status" && parts.length === 1) {
    return statusResponse(ctx);
  }
  if (root === "sandboxes" && parts.length <= 2) {
    return dispatchSandboxes(ctx, request, id);
  }
  if (root === "clients" && parts.length <= 3) {
    return dispatchClients(ctx, request, id, rest[0]);
  }
  if (root === "playtests" && parts.length <= 2) {
    return dispatchPlaytests(ctx, request, id);
  }
  if (root === LIVE_TARGET_ID && id !== undefined && parts.length === 2) {
    return dispatchLive(ctx, url, request, id);
  }
  if (root === "targets" && id !== undefined && rest.length > 0) {
    return dispatchTarget(ctx, url, request, { id, action: rest.join("/") });
  }
  throw new DaemonError(`Unknown route ${request.method} ${url.pathname}`, 404);
}

export async function routeRequest(
  ctx: DaemonContext,
  url: URL,
  request: Request,
): Promise<Response> {
  ctx.lastActivity = Date.now();
  try {
    return await dispatch(ctx, url, request);
  } catch (error) {
    if (error instanceof DaemonError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const live = liveErrorResponse(error, ctx.log, url.pathname);
    if (live !== null) {
      return live;
    }
    if (error instanceof BridgeRequestError) {
      return Response.json(
        { error: `bridge ${error.code}: ${error.message}` },
        {
          status:
            error.status >= 400 && error.status < 600 ? error.status : 502,
        },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    ctx.log("request failed", { path: url.pathname, error: message });
    return Response.json({ error: message }, { status: 500 });
  }
}
