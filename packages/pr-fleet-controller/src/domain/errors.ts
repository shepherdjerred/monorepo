/**
 * Errors that cross a layer boundary.
 *
 * Both of these are raised by one layer and caught by another — the shutdown
 * error is thrown by the controller and unwrapped by the CLI, and the
 * head-change error is raised by the environment adapter and handled by the
 * controller's evidence refresh. Keeping the classes in `domain/` lets the
 * thrower and the catcher agree on the contract without the lower layer having
 * to import the higher one.
 */
import type { FleetSnapshot } from "./schemas.ts";

export class ControllerStopError extends Error {
  readonly snapshot: FleetSnapshot;

  constructor(snapshot: FleetSnapshot, failure: Error) {
    super(failure.message, { cause: failure });
    this.name = "ControllerStopError";
    this.snapshot = snapshot;
  }
}

export class PrHeadChangedDuringRefreshError extends Error {
  readonly prNumber: number;
  readonly expectedHead: string;
  readonly actualHead: string;

  constructor(prNumber: number, expectedHead: string, actualHead: string) {
    super(
      `PR #${String(prNumber)} changed during evidence refresh (${expectedHead} -> ${actualHead})`,
    );
    this.name = "PrHeadChangedDuringRefreshError";
    this.prNumber = prNumber;
    this.expectedHead = expectedHead;
    this.actualHead = actualHead;
  }
}
