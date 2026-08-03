import type { FleetSnapshot } from "./schemas.ts";

export class ControllerStopError extends Error {
  readonly snapshot: FleetSnapshot;

  constructor(snapshot: FleetSnapshot, failure: Error) {
    super(failure.message, { cause: failure });
    this.name = "ControllerStopError";
    this.snapshot = snapshot;
  }
}
