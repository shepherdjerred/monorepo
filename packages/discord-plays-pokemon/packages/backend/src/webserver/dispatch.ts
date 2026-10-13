// Handles each request a page sends. One function per request kind; every
// reply goes back to the sending socket only.
import type { Socket } from "socket.io";
import type {
  InputResultResponse,
  Request,
} from "@discord-plays-pokemon/common";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { Config } from "#src/config/schema.ts";
import { enqueueCommand } from "#src/emulator/command-sink.ts";
import { parseChord, type Chord } from "#src/game/command/chord.ts";
import {
  effectiveChordDelay,
  executeInteractiveChord,
} from "#src/game/command/chord-executor.ts";
import { isValid } from "#src/game/command/chord-validator.ts";
import type { InputLog } from "#src/game/input-log.ts";
import type { ActiveSessionRuntime } from "#src/lifecycle/pokemon-driver.ts";
import type { PlayPolicy } from "./play-policy.ts";
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
  readonly publisher: Pick<WebPublisher, "sendStatus" | "sendSnapshot">;
  readonly policy: PlayPolicy;
};

export async function handleRequest(
  {
    request,
    socket,
    user,
  }: {
    request: Request;
    socket: ReplySocket;
    user: DiscordUser | undefined;
  },
  deps: DispatchDeps,
): Promise<void> {
  switch (request.kind) {
    case "command":
      await handleCommand(request.value, socket, user, deps);
      return;
    case "status":
      deps.publisher.sendStatus(socket, user);
      return;
    case "snapshot":
      deps.publisher.sendSnapshot(socket, user);
      return;
  }
}

/** Run a chord from the page under the same limits as Discord chat. */
async function handleCommand(
  text: string,
  socket: ReplySocket,
  user: DiscordUser | undefined,
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

  const blocker = deps.policy.blockerFor(user);
  if (blocker !== null) {
    reply({ accepted: false, command, reason: blocker });
    return;
  }
  if (user === undefined)
    throw new Error("play policy admitted an unsigned player");

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
  deps.driver.inputLog.record({ user: user.name, source: "web", command });
  reply({ accepted: true, command });
}
