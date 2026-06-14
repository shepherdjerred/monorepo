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
import { isValid } from "#src/discord/chord-validator.ts";
import { execute } from "#src/discord/chord-executor.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { formatGameStateForPrompt } from "./game-state-summary.ts";
import { formatHistoryForPrompt } from "./history-summary.ts";
import type { GoalManager } from "./goal-manager.ts";

type GoalControlServerOptions = {
  emulator: Emulator;
  goalManager: GoalManager;
  config: Config;
  token: string;
};

type GoalControlContext = GoalControlServerOptions & {
  timing: CommandTiming;
};

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
  const snapshot = readGameSnapshot(
    context.emulator.memoryReader(),
    context.emulator.gameSymbols(),
  );
  return textResponse(formatGameStateForPrompt(snapshot));
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
  if (quantity > context.config.game.commands.max_quantity_per_action) {
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
  if (chord === undefined || !isValid(chord)) {
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
    default:
      return jsonResponse({ error: "not found" }, 404);
  }
}

export function startGoalControlServer(
  options: GoalControlServerOptions,
): GoalControlServer {
  const timing = timingFromConfig(options.config);
  const context: GoalControlContext = { ...options, timing };

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
