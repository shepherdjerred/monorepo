import type { Config } from "#src/config/schema.ts";
import type { Emulator } from "#src/emulator/emulator.ts";
import type { CommandTiming } from "#src/emulator/command-sink.ts";
import type { GoalManager } from "./goal-manager.ts";
import type { GameController } from "./game-controller.ts";

export type GoalControlServerOptions = {
  emulator: Emulator;
  goalManager: GoalManager;
  config: Config;
  token: string;
};

// Per-session control state. The server is recreated per goal session, so
// memoryRead resets naturally — it gates WRITE(MEMORY.md) on a prior READ.
export type FsSessionState = {
  memoryRead: boolean;
};

export type GoalControlContext = GoalControlServerOptions & {
  timing: CommandTiming;
  controller: GameController;
  fs: FsSessionState;
};

export type Routed = {
  response: Response;
  requestMeta?: unknown;
  logBody?: unknown;
};
