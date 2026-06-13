import { createDesiredStreamMachine as createDesiredStreamMachineImpl } from "./desired-stream-machine.ts";
import { createRawGoLiveMachine as createRawGoLiveMachineImpl } from "./raw-go-live-machine.ts";
import type { RawGoLiveDeps } from "./types.ts";

export function createRawGoLiveMachine(deps: RawGoLiveDeps) {
  return createRawGoLiveMachineImpl(deps);
}

export function createDesiredStreamMachine(deps: RawGoLiveDeps) {
  return createDesiredStreamMachineImpl(deps);
}
