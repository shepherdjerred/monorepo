import { createDesiredStreamMachine as createDesiredStreamMachineImpl } from "./desired-stream-machine.ts";
import { createRawGoLiveMachine as createRawGoLiveMachineImpl } from "./raw-go-live-machine.ts";
import type { RawGoLiveDeps } from "./types.ts";

export function createRawGoLiveMachine(deps: RawGoLiveDeps) {
  return createRawGoLiveMachineImpl(deps);
}

export function createDesiredStreamMachine(deps: RawGoLiveDeps) {
  return createDesiredStreamMachineImpl(deps);
}

// Pool, session manager, slash commands, and game-driver primitives are exposed at
// their own subpaths via the `./*` pattern in `package.json#exports`. Consumers should
// import directly from those paths, e.g.:
//
//   import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool.ts";
//   import { SingleSlotSessionManager } from "@shepherdjerred/discord-stream-lifecycle/session/session-manager.ts";
//
// This keeps the root entry point lean and avoids the no-re-exports lint rule.
