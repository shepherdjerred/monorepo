// Handles each request a page sends. One function per request kind; every
// reply goes back to the sending socket only.
import type { Socket } from "socket.io";
import type {
  InputResultResponse,
  LoginResponse,
  Request,
  ScreenshotResponse,
} from "@discord-plays-pokemon/common";
import { encodePng } from "@shepherdjerred/discord-plays-core/image/png.ts";
import type { Config } from "#src/config/schema.ts";
import { enqueueCommand } from "#src/emulator/command-sink.ts";
import { HEIGHT, WIDTH } from "#src/emulator/constants.ts";
import { parseChord, type Chord } from "#src/game/command/chord.ts";
import {
  effectiveChordDelay,
  executeInteractiveChord,
} from "#src/game/command/chord-executor.ts";
import { isValid } from "#src/game/command/chord-validator.ts";
import type { InputLog } from "#src/game/input-log.ts";
import type { ActiveSessionRuntime } from "#src/lifecycle/pokemon-driver.ts";
import { logger } from "#src/logger.ts";
import type { WebPublisher } from "./web-publisher.ts";

/** The slice of the game driver the page's requests touch. */
export type DispatchDriver = {
  getActiveRuntime: () => Pick<
    ActiveSessionRuntime,
    "emulator" | "timing"
  > | null;
  readonly inputLog: InputLog;
};

/** Replies go back to the requesting page only. */
export type ReplySocket = Pick<Socket, "emit">;

export type DispatchDeps = {
  readonly driver: DispatchDriver;
  readonly config: Config;
  readonly publisher: Pick<WebPublisher, "sendStatus">;
};

export async function handleRequest(
  { request, socket }: { request: Request; socket: ReplySocket },
  deps: DispatchDeps,
): Promise<void> {
  switch (request.kind) {
    case "command":
      await handleCommand(request.value, socket, deps);
      return;
    case "login": {
      const player = { discordId: "id", discordUsername: "username" };
      const response: LoginResponse = { kind: "login", value: player };
      socket.emit("response", response);
      return;
    }
    case "screenshot": {
      const active = deps.driver.getActiveRuntime();
      if (active === null) {
        logger.error("no active session for screenshot request");
        return;
      }
      const png = encodePng(active.emulator.renderFrame(), WIDTH, HEIGHT, 3);
      const response: ScreenshotResponse = {
        kind: "screenshot",
        value: png.toString("base64"),
      };
      socket.emit("response", response);
      return;
    }
    case "status":
      deps.publisher.sendStatus(socket);
      return;
  }
}

/** Run a chord from the page under the same limits as Discord chat. */
async function handleCommand(
  text: string,
  socket: ReplySocket,
  deps: DispatchDeps,
): Promise<void> {
  const reply = (response: InputResultResponse["value"]) => {
    const message: InputResultResponse = {
      kind: "input-result",
      value: response,
    };
    socket.emit("response", message);
  };
  const command = text.trim();

  const active = deps.driver.getActiveRuntime();
  if (active === null) {
    reply({ accepted: false, command, reason: "no-session" });
    return;
  }

  let chord: Chord | undefined;
  try {
    chord = parseChord(command);
  } catch {
    chord = undefined;
  }
  const limits = deps.config.game.commands;
  if (
    chord === undefined ||
    !isValid(chord, {
      maxCommands: limits.chord.max_commands,
      maxTotal: limits.chord.max_total,
      maxQuantityPerAction: limits.max_quantity_per_action,
    })
  ) {
    reply({ accepted: false, command, reason: "invalid" });
    return;
  }

  const accepted = await executeInteractiveChord(
    chord,
    (commandInput) =>
      enqueueCommand(active.emulator, commandInput, active.timing),
    effectiveChordDelay(
      limits.chord.delay,
      limits.delay_between_actions_in_milliseconds,
    ),
  );
  if (!accepted) {
    reply({ accepted: false, command, reason: "goal-mode" });
    return;
  }
  if (deps.driver.getActiveRuntime() !== active) {
    reply({ accepted: false, command, reason: "no-session" });
    return;
  }
  deps.driver.inputLog.record({ user: "Web player", source: "web", command });
  reply({ accepted: true, command });
}
