import path from "node:path";
import { z } from "zod";
import type { Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";
import type { Emulator } from "#src/emulator/emulator.ts";
import {
  enqueueCommand,
  framesFromMs,
  type CommandTiming,
} from "#src/emulator/command-sink.ts";
import { encodePng } from "#src/emulator/png.ts";
import { parseCommandInput } from "#src/game/command/command-input.ts";
import { parseChord } from "#src/game/command/chord.ts";
import { isValid, type ChordLimits } from "#src/discord/chord-validator.ts";
import { execute } from "#src/discord/chord-executor.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import { formatGameStateForPrompt } from "./game-state-summary.ts";
import { formatHistoryForPrompt } from "./history-summary.ts";
import type { GoalManager } from "./goal-manager.ts";
import type { FsEntry, GrepMatch } from "./goal-memory.ts";

type GoalControlServerOptions = {
  emulator: Emulator;
  goalManager: GoalManager;
  config: Config;
  token: string;
};

// Per-session control state. The server is recreated per goal session, so
// memoryRead resets naturally — it gates WRITE(MEMORY.md) on a prior READ.
type FsSessionState = {
  memoryRead: boolean;
};

type GoalControlContext = GoalControlServerOptions & {
  timing: CommandTiming;
  fs: FsSessionState;
};

function goalChordLimits(goal: Config["game"]["goal"]): ChordLimits {
  const limits = goal.command_limits;
  return {
    maxCommands: limits.chord_max_commands,
    maxTotal: limits.chord_max_total,
    maxQuantityPerAction: limits.max_quantity_per_action,
  };
}

export type GoalControlServer = ReturnType<typeof Bun.serve>;

const PressRequestSchema = z.strictObject({
  command: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  holdMs: z.number().int().positive().optional(),
});

const ChordRequestSchema = z.strictObject({
  value: z.string().min(1),
});

const ProgressRequestSchema = z.strictObject({
  message: z.string().min(1).max(1000),
});

// Scoped memory filesystem (LIST/READ/GREP/WRITE). Paths are relative to the
// per-guild memory root and resolved inside it by GoalMemory.
const PathQuerySchema = z.strictObject({
  // Optional for list/grep (default = root); required for read.
  path: z.string().optional(),
});

const GrepQuerySchema = z.strictObject({
  q: z.string().min(1),
  path: z.string().optional(),
});

// Content cap is deliberately above GoalMemory's own char cap so its clearer
// "too long (N chars; keep it under M)" error reaches the agent instead of a
// generic schema rejection.
const WriteRequestSchema = z.strictObject({
  path: z.string().min(1),
  content: z.string().min(1).max(64_000),
});

function timingFromConfig(config: Config): CommandTiming {
  const commandConfig = config.game.commands;
  return {
    pressFrames: framesFromMs(commandConfig.key_press_duration_in_milliseconds),
    holdFrames: framesFromMs(commandConfig.hold.duration_in_milliseconds),
    burstHoldFrames: framesFromMs(commandConfig.burst.duration_in_milliseconds),
    burstGapFrames: framesFromMs(commandConfig.burst.delay_in_milliseconds),
    burstQuantity: commandConfig.burst.quantity,
  };
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new Error("Request body must be valid JSON", { cause: error });
  }
}

function authenticate(request: Request, token: string): boolean {
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function screenshotDirectory(config: Config["game"]["goal"]): string {
  return path.isAbsolute(config.screenshot_dir)
    ? config.screenshot_dir
    : path.resolve(config.runtime_directory, config.screenshot_dir);
}

function statusResponse(context: GoalControlContext): Response {
  return jsonResponse({
    frame: context.emulator.frame,
    goal: context.goalManager.getStatus(),
  });
}

// The model reads /state's response as plain text and inlines it into its
// reasoning. text/plain (not JSON) keeps the prompt tokens minimal — no
// keys, no escaping, no quotes.
function stateResponse(context: GoalControlContext): Response {
  const reader = context.emulator.memoryReader();
  const symbols = context.emulator.gameSymbols();
  const snapshot = readGameSnapshot(reader, symbols);
  const spatial = readSpatialSnapshot(reader, symbols);
  return textResponse(formatGameStateForPrompt(snapshot, spatial));
}

const HistoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

function historyResponse(
  context: GoalControlContext,
  request: Request,
): Response {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = HistoryQuerySchema.safeParse(params);
  if (!parsed.success) {
    return jsonResponse(
      { error: "limit must be an integer between 1 and 10" },
      400,
    );
  }
  const limit = parsed.data.limit ?? 3;
  const entries = context.goalManager.getHistory(limit);
  return textResponse(formatHistoryForPrompt(entries));
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function queryParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

// ── Scoped memory filesystem (`pokemonctl list/read/grep/write`). ────────────

async function listResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = PathQuerySchema.safeParse(queryParams(request));
  if (!parsed.success) {
    return jsonResponse({ error: "invalid path" }, 400);
  }
  const entries = await context.goalManager.memory.list(parsed.data.path ?? "");
  return textResponse(formatList(entries));
}

async function readResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = PathQuerySchema.safeParse(queryParams(request));
  if (!parsed.success || parsed.data.path === undefined) {
    return jsonResponse({ error: "read requires a path parameter" }, 400);
  }
  const memory = context.goalManager.memory;
  // Reading MEMORY.md satisfies the read-before-write guard for this session.
  // It reads through readMemory() so an as-yet-unwritten MEMORY.md returns empty
  // (not "not found") — otherwise the first-ever curate could never satisfy the
  // gate.
  if (memory.isMemoryPath(parsed.data.path)) {
    context.fs.memoryRead = true;
    const memoryText = await memory.readMemory();
    return textResponse(
      memoryText.length > 0
        ? memoryText
        : "(MEMORY.md is empty — write your first curated memory)",
    );
  }
  const text = await memory.read(parsed.data.path);
  return textResponse(text);
}

async function grepResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = GrepQuerySchema.safeParse(queryParams(request));
  if (!parsed.success) {
    return jsonResponse(
      { error: "grep requires a non-empty q parameter" },
      400,
    );
  }
  const matches = await context.goalManager.memory.grep(
    parsed.data.q,
    parsed.data.path ?? "",
  );
  return textResponse(formatGrep(matches, parsed.data.q));
}

async function writeResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = WriteRequestSchema.parse(await parseJsonBody(request));
  const memory = context.goalManager.memory;
  if (!memory.isMemoryPath(parsed.path)) {
    return jsonResponse(
      { error: "only MEMORY.md is writable (logs/archives are read-only)" },
      400,
    );
  }
  if (!context.fs.memoryRead) {
    return jsonResponse(
      { error: "read MEMORY.md before writing it (read-before-write)" },
      409,
    );
  }
  const result = await memory.writeMemory(parsed.content);
  return jsonResponse({
    ok: true,
    path: result.path,
    chars: result.chars,
    archived: result.archivedPath,
  });
}

function formatList(entries: readonly FsEntry[]): string {
  if (entries.length === 0) {
    return "(empty)";
  }
  return entries
    .map((entry) => `${entry.kind === "dir" ? "dir " : "file"}  ${entry.path}`)
    .join("\n");
}

function formatGrep(matches: readonly GrepMatch[], query: string): string {
  if (matches.length === 0) {
    return `No matches for "${query}".`;
  }
  return matches
    .map((match) => `${match.path}:${String(match.line)}: ${match.text}`)
    .join("\n");
}

async function screenshotResponse(
  context: GoalControlContext,
): Promise<Response> {
  const png = encodePng(context.emulator.renderFrame(), 3);
  const filePath = path.join(
    screenshotDirectory(context.config.game.goal),
    `pokemon-${String(context.emulator.frame)}-${String(Date.now())}.png`,
  );
  await Bun.write(filePath, png, { createPath: true });
  return jsonResponse({
    path: filePath,
    frame: context.emulator.frame,
  });
}

async function pressResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = PressRequestSchema.parse(await parseJsonBody(request));
  const commandInput = parseCommandInput(parsed.command);
  if (commandInput === undefined) {
    return jsonResponse({ error: "invalid command" }, 400);
  }

  const quantity = parsed.quantity ?? 1;
  if (
    quantity > context.config.game.goal.command_limits.max_quantity_per_action
  ) {
    return jsonResponse({ error: "quantity too high" }, 400);
  }

  const nextCommand =
    parsed.holdMs === undefined
      ? { ...commandInput, quantity }
      : {
          command: commandInput.command,
          quantity,
          modifier: "_" as const,
        };
  const nextTiming =
    parsed.holdMs === undefined
      ? context.timing
      : {
          ...context.timing,
          holdFrames: framesFromMs(parsed.holdMs),
        };
  await enqueueCommand(context.emulator, nextCommand, nextTiming);

  return jsonResponse({
    ok: true,
    frame: context.emulator.frame,
  });
}

async function chordResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = ChordRequestSchema.parse(await parseJsonBody(request));
  const chord = parseChord(parsed.value);
  if (
    chord === undefined ||
    !isValid(chord, goalChordLimits(context.config.game.goal))
  ) {
    return jsonResponse({ error: "invalid chord" }, 400);
  }

  await execute(chord, async (commandInput) => {
    await enqueueCommand(context.emulator, commandInput, context.timing);
  });
  return jsonResponse({
    ok: true,
    frame: context.emulator.frame,
  });
}

async function progressResponse(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const parsed = ProgressRequestSchema.parse(await parseJsonBody(request));
  const published = await context.goalManager.publishProgress(parsed.message);
  return jsonResponse({
    ok: published,
    throttled: !published,
  });
}

async function routeRequest(
  context: GoalControlContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  switch (`${request.method} ${url.pathname}`) {
    case "GET /status":
      return statusResponse(context);
    case "GET /state":
      return stateResponse(context);
    case "GET /history":
      return historyResponse(context, request);
    case "POST /screenshot":
      return await screenshotResponse(context);
    case "POST /press":
      return await pressResponse(context, request);
    case "POST /chord":
      return await chordResponse(context, request);
    case "POST /progress":
      return await progressResponse(context, request);
    case "GET /list":
      return await listResponse(context, request);
    case "GET /read":
      return await readResponse(context, request);
    case "GET /grep":
      return await grepResponse(context, request);
    case "POST /write":
      return await writeResponse(context, request);
    default:
      return jsonResponse({ error: "not found" }, 404);
  }
}

export function startGoalControlServer(
  options: GoalControlServerOptions,
): GoalControlServer {
  const timing = timingFromConfig(options.config);
  const context: GoalControlContext = {
    ...options,
    timing,
    fs: { memoryRead: false },
  };

  const server = Bun.serve({
    hostname: options.config.game.goal.control_host,
    port: options.config.game.goal.control_port,
    async fetch(request) {
      if (!authenticate(request, options.token)) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      try {
        return await routeRequest(context, request);
      } catch (error) {
        logger.error(error);
        return jsonResponse(
          {
            error: error instanceof Error ? error.message : "unknown error",
          },
          400,
        );
      }
    },
  });

  logger.info(
    `goal control server listening at ${options.config.game.goal.control_host}:${String(
      options.config.game.goal.control_port,
    )}`,
  );
  return server;
}
