import path from "node:path";
import { z } from "zod";
import type { Config } from "#src/config/schema.ts";
import { enqueueCommand, framesFromMs } from "#src/emulator/command-sink.ts";
import { encodePng } from "#src/emulator/png.ts";
import { parseCommandInput } from "#src/game/command/command-input.ts";
import { parseChord } from "#src/game/command/chord.ts";
import { isValid, type ChordLimits } from "#src/discord/chord-validator.ts";
import { effectiveChordDelay, execute } from "#src/discord/chord-executor.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import { formatGameStateForPrompt } from "./game-state-summary.ts";
import type { FsEntry, GrepMatch } from "./goal-memory.ts";
import { truncateStateForToolLog } from "./goal-tool-log.ts";
import type { GoalControlContext, Routed } from "./control-context.ts";
import {
  mapResponse,
  routeSemanticRequest,
} from "./semantic-control-routes.ts";
import { routeInformationalRequest } from "./informational-control-routes.ts";

const PressRequestSchema = z.strictObject({
  command: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  holdMs: z.number().int().positive().optional(),
});

const ChordRequestSchema = z.strictObject({
  value: z.string().min(1),
});

const ObserveQuerySchema = z.strictObject({
  screenshot: z.literal("true").optional(),
});

const ProgressRequestSchema = z.strictObject({
  message: z.string().min(1).max(1000),
});

const PathQuerySchema = z.strictObject({
  path: z.string().optional(),
});

const GrepQuerySchema = z.strictObject({
  q: z.string().min(1),
  path: z.string().optional(),
});

const WriteRequestSchema = z.strictObject({
  path: z.string().min(1),
  content: z.string().min(1).max(64_000),
});

function goalChordLimits(goal: Config["game"]["goal"]): ChordLimits {
  const limits = goal.command_limits;
  return {
    maxCommands: limits.chord_max_commands,
    maxTotal: limits.chord_max_total,
    maxQuantityPerAction: limits.max_quantity_per_action,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
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

function screenshotDirectory(config: Config["game"]["goal"]): string {
  return path.isAbsolute(config.screenshot_dir)
    ? config.screenshot_dir
    : path.resolve(config.runtime_directory, config.screenshot_dir);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new Error("Request body must be valid JSON", { cause: error });
  }
}

function statusResponse(context: GoalControlContext): Response {
  return jsonResponse({
    frame: context.emulator.frame,
    goal: context.goalManager.getStatus(),
  });
}

function stateResponse(context: GoalControlContext): {
  response: Response;
  logBody: string;
} {
  const reader = context.emulator.memoryReader();
  const symbols = context.emulator.gameSymbols();
  const snapshot = readGameSnapshot(reader, symbols);
  const spatial = readSpatialSnapshot(reader, symbols);
  const body = formatGameStateForPrompt(snapshot, spatial);
  return { response: textResponse(body), logBody: body };
}

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
  if (memory.isMemoryPath(parsed.data.path)) {
    context.fs.memoryRead = true;
    const memoryText = await memory.readMemory();
    return textResponse(
      memoryText.length > 0
        ? memoryText
        : "(MEMORY.md is empty — write your first curated memory)",
    );
  }
  return textResponse(await memory.read(parsed.data.path));
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
): Promise<{ response: Response; logBody: unknown }> {
  const body = await captureScreenshot(context);
  return { response: jsonResponse(body), logBody: body };
}

async function captureScreenshot(
  context: GoalControlContext,
): Promise<{ path: string; frame: number }> {
  const png = encodePng(context.emulator.renderFrame(), 3);
  const filePath = path.join(
    screenshotDirectory(context.config.game.goal),
    `pokemon-${String(context.emulator.frame)}-${String(Date.now())}.png`,
  );
  await Bun.write(filePath, png, { createPath: true });
  return { path: filePath, frame: context.emulator.frame };
}

async function observeResponse(
  context: GoalControlContext,
  request: Request,
): Promise<{ response: Response; requestMeta: unknown; logBody: unknown }> {
  const params = queryParams(request);
  const parsed = ObserveQuerySchema.safeParse(params);
  if (!parsed.success) {
    return {
      response: jsonResponse({ error: "invalid observe query" }, 400),
      requestMeta: params,
      logBody: { error: "invalid observe query" },
    };
  }
  const observation = context.controller.observe();
  const screenshot =
    parsed.data.screenshot === "true"
      ? await captureScreenshot(context)
      : undefined;
  const body = {
    ...observation,
    ...(screenshot === undefined ? {} : { screenshot }),
  };
  return {
    response: jsonResponse(body),
    requestMeta: {
      screenshot: parsed.data.screenshot === "true",
    },
    logBody: truncateStateForToolLog(JSON.stringify(body)),
  };
}

async function pressResponse(
  context: GoalControlContext,
  request: Request,
): Promise<{ response: Response; requestMeta: unknown; logBody: unknown }> {
  const parsed = PressRequestSchema.parse(await parseJsonBody(request));
  const requestMeta = {
    command: parsed.command,
    quantity: parsed.quantity ?? 1,
    holdMs: parsed.holdMs ?? null,
  };
  const commandInput = parseCommandInput(parsed.command);
  if (commandInput === undefined) {
    return {
      response: jsonResponse({ error: "invalid command" }, 400),
      requestMeta,
      logBody: { error: "invalid command" },
    };
  }
  const quantity = parsed.quantity ?? 1;
  if (
    quantity > context.config.game.goal.command_limits.max_quantity_per_action
  ) {
    return {
      response: jsonResponse({ error: "quantity too high" }, 400),
      requestMeta,
      logBody: { error: "quantity too high" },
    };
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
  const body =
    parsed.holdMs === undefined && nextCommand.modifier === undefined
      ? await context.controller.tap(nextCommand.command, quantity)
      : await context.controller.perform("press:raw", async () => {
          await enqueueCommand(
            context.emulator,
            nextCommand,
            nextTiming,
            "goal",
          );
        });
  return { response: jsonResponse(body), requestMeta, logBody: body };
}

async function chordResponse(
  context: GoalControlContext,
  request: Request,
): Promise<{ response: Response; requestMeta: unknown; logBody: unknown }> {
  const parsed = ChordRequestSchema.parse(await parseJsonBody(request));
  const requestMeta = { value: parsed.value };
  const chord = parseChord(parsed.value);
  if (
    chord === undefined ||
    !isValid(chord, goalChordLimits(context.config.game.goal))
  ) {
    return {
      response: jsonResponse({ error: "invalid chord" }, 400),
      requestMeta,
      logBody: { error: "invalid chord" },
    };
  }
  const body = await context.controller.perform("chord:raw", async () => {
    await execute(
      chord,
      async (commandInput) => {
        await enqueueCommand(
          context.emulator,
          commandInput,
          context.timing,
          "goal",
        );
      },
      effectiveChordDelay(
        context.config.game.commands.chord.delay,
        context.config.game.commands.delay_between_actions_in_milliseconds,
      ),
    );
  });
  return { response: jsonResponse(body), requestMeta, logBody: body };
}

async function progressResponse(
  context: GoalControlContext,
  request: Request,
): Promise<{ response: Response; requestMeta: unknown; logBody: unknown }> {
  const parsed = ProgressRequestSchema.parse(await parseJsonBody(request));
  const published = await context.goalManager.publishProgress(parsed.message);
  const body = { ok: published, throttled: !published };
  return {
    response: jsonResponse(body),
    requestMeta: { message: parsed.message },
    logBody: body,
  };
}

export async function routeRequest(
  context: GoalControlContext,
  request: Request,
): Promise<Routed> {
  const informational = await routeInformationalRequest(context, request);
  if (informational !== undefined) return informational;
  const semantic = await routeSemanticRequest(context, request);
  if (semantic !== undefined) return semantic;

  const url = new URL(request.url);
  switch (`${request.method} ${url.pathname}`) {
    case "GET /status":
      return {
        response: statusResponse(context),
        logBody: {
          frame: context.emulator.frame,
          goal: context.goalManager.getStatus()?.id,
        },
      };
    case "GET /state": {
      const result = stateResponse(context);
      return {
        response: result.response,
        logBody: truncateStateForToolLog(result.logBody),
      };
    }
    case "GET /observe":
      return await observeResponse(context, request);
    case "GET /map":
      return mapResponse(context, request);
    case "POST /screenshot":
      return await screenshotResponse(context);
    case "POST /press":
      return await pressResponse(context, request);
    case "POST /chord":
      return await chordResponse(context, request);
    case "POST /progress":
      return await progressResponse(context, request);
    case "GET /list": {
      const response = await listResponse(context, request);
      return {
        response,
        requestMeta: queryParams(request),
        logBody: { status: response.status },
      };
    }
    case "GET /read": {
      const response = await readResponse(context, request);
      return {
        response,
        requestMeta: queryParams(request),
        logBody: { status: response.status },
      };
    }
    case "GET /grep": {
      const response = await grepResponse(context, request);
      return {
        response,
        requestMeta: queryParams(request),
        logBody: { status: response.status },
      };
    }
    case "POST /write": {
      const response = await writeResponse(context, request);
      return { response, logBody: { status: response.status } };
    }
    default:
      return {
        response: jsonResponse({ error: "not found" }, 404),
        logBody: { error: "not found" },
      };
  }
}

export { jsonResponse };
