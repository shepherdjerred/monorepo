import { z } from "zod";
import type { Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";
import {
  framesFromMs,
  type CommandTiming,
} from "#src/emulator/command-sink.ts";
import { logGoalTool } from "./goal-tool-log.ts";
import {
  type GoalControlContext,
  type GoalControlServerOptions,
} from "./control-context.ts";
import { jsonResponse, routeRequest } from "./control-routes.ts";
import { GameController } from "./game-controller.ts";
import { readGameObservation } from "./game-observation.ts";
import { enqueueCommand } from "#src/emulator/command-sink.ts";

export type GoalControlServer = ReturnType<typeof Bun.serve>;

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

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") === true
    ? authorization.slice("Bearer ".length)
    : undefined;
}

export function startGoalControlServer(
  options: GoalControlServerOptions,
): GoalControlServer {
  const timing = timingFromConfig(options.config);
  const controller = new GameController({
    observe: () => readGameObservation(options.emulator),
    renderFrame: () => options.emulator.renderFrame(),
    press: async (command) => {
      await enqueueCommand(options.emulator, command, timing, "goal");
    },
    waitFrames: async (frames) => {
      await options.emulator.queuePress(0, frames, 0, "goal");
    },
    readMapTile: (x, y) => options.emulator.engineMapTile(x, y),
    readMapTopology: () => options.emulator.engineMapTopology(),
    canRunFromBattle: (battler) =>
      options.emulator.engineCanRunFromBattle(battler),
    canUseBattleItemOnBattler: (itemId, battler) =>
      options.emulator.engineCanUseBattleItemOnBattler(itemId, battler),
    canUseBattleItemOnPartyMon: (itemId, partySlot) =>
      options.emulator.engineCanUseBattleItemOnPartyMon(itemId, partySlot),
  });
  const context: GoalControlContext = {
    ...options,
    timing,
    controller,
    fs: { memoryRead: false },
  };

  const server = Bun.serve({
    hostname: options.config.game.goal.control_host,
    port: options.config.game.goal.control_port,
    async fetch(request) {
      const token = bearerToken(request);
      const goalId = request.headers.get("x-pokemon-goal-id") ?? undefined;
      if (token === undefined || goalId === undefined) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      const finishControl = options.goalManager.beginControlRequest(
        token,
        goalId,
      );
      if (finishControl === undefined) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      try {
        const url = new URL(request.url);
        const startedAt = Date.now();
        try {
          const routed = await routeRequest(context, request);
          options.goalManager.recordToolCall(goalId, {
            method: request.method,
            path: url.pathname,
            status: routed.response.status,
          });
          logGoalTool({
            goalId,
            method: request.method,
            path: url.pathname,
            durationMs: Date.now() - startedAt,
            status: routed.response.status,
            request: routed.requestMeta,
            response: routed.logBody,
          });
          return routed.response;
        } catch (error) {
          // Invalid input is a routine agent misfire — the prettified 400 body
          // is the correction signal, so log it at warn. Anything else is an
          // unexpected route failure and stays at error.
          const isZodError = error instanceof z.ZodError;
          const message = isZodError
            ? z.prettifyError(error)
            : error instanceof Error
              ? error.message
              : "unknown error";
          if (isZodError) {
            logger.warn(
              `goal control invalid input: ${request.method} ${url.pathname}: ${message}`,
              { goalId },
            );
          } else {
            logger.error(
              `goal control request failed: ${request.method} ${url.pathname}: ${message}`,
              { goalId },
            );
          }
          const errorBody = { error: message };
          options.goalManager.recordToolCall(goalId, {
            method: request.method,
            path: url.pathname,
            status: 400,
          });
          logGoalTool({
            goalId,
            method: request.method,
            path: url.pathname,
            durationMs: Date.now() - startedAt,
            status: 400,
            response: errorBody,
          });
          return jsonResponse(errorBody, 400);
        }
      } finally {
        finishControl();
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
