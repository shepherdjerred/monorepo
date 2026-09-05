import type { GameObservationV2 } from "./game-observation.ts";

export type ExitNavigationStopReason =
  | "exit-traversed"
  | "exit-triggered"
  | "exit-not-found"
  | "exit-not-navigable"
  | "topology-unavailable"
  | "topology-mismatch"
  | "no-route"
  | "max-steps"
  | "unexpected-map-change"
  | "phase-changed"
  | "field-input-not-ready"
  | "settle-timeout"
  | "activation-no-effect";

export type ExitNavigationOutcomeV1 = Readonly<{
  schemaVersion: 1;
  action: "navigate-exit";
  exitId: string;
  status: "traversed" | "triggered" | "stopped";
  stopReason: ExitNavigationStopReason;
  map: Readonly<{ group: number; number: number }> | null;
  attemptsMade: number;
  stepsTaken: number;
  before: GameObservationV2;
  after: GameObservationV2;
}>;
