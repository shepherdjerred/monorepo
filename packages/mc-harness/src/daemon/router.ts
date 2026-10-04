import { z } from "zod";
import { BridgeRequestError } from "#bridge/client.ts";
import {
  BoxSchema,
  CommandRequestSchema,
  CommandResponseSchema,
  EventsResponseSchema,
  InfoResponseSchema,
  PlayersResponseSchema,
  RegionReadResponseSchema,
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
import { PROTOCOL_VERSION } from "#protocol/version.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import { toSummary } from "#sandbox/record.ts";
import type { Target } from "#src/target.ts";

export type DaemonContext = {
  provider: SandboxProvider;
  /** Resolves a ready sandbox to a target; throws DaemonError(404) otherwise. */
  target: (id: string) => Promise<Target>;
  startedAt: string;
  ttlSeconds: number;
  repoRoot: string;
  lastActivity: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

export class DaemonError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SnapshotRestoreBodySchema = z.strictObject({ id: z.string().min(1) });

async function body<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new DaemonError("Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DaemonError(`Invalid request: ${parsed.error.message}`);
  }
  return parsed.data;
}

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

/** Validates an outgoing body so the daemon never emits off-contract JSON. */
function reply(schema: z.ZodType, value: unknown): Response {
  return Response.json(schema.parse(value));
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
      return reply(CommandResponseSchema, await bridge.command(command));
    }
    case "we": {
      const run = await body(request, WeRunRequestSchema);
      ctx.log("we", {
        target: id,
        world: run.world,
        commands: run.ops.map((op) => op.command),
      });
      return reply(WeRunResponseSchema, await bridge.weRun(run));
    }
    case "paste": {
      const paste = await body(request, WePasteRequestSchema);
      ctx.log("paste", { target: id, world: paste.world, at: paste.at });
      return reply(WePasteResponseSchema, await bridge.wePaste(paste));
    }
    case "undo": {
      const undo = await body(request, WeUndoRequestSchema);
      return reply(WeUndoResponseSchema, await bridge.weUndo(undo));
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
        await bridge.snapshotRestore(sid),
      );
    }
  }
  return null;
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
  const handler =
    request.method === "GET"
      ? targetGet
      : request.method === "POST"
        ? targetPost
        : null;
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
    await ctx.provider.destroy(parsed.data);
    ctx.log("sandbox removed", { id: parsed.data });
    return reply(SandboxDownResponseSchema, { removed: [parsed.data] });
  }
  throw new DaemonError(`Unknown route ${request.method} /sandboxes`, 404);
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
