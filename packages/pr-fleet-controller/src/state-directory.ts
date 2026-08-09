import { homedir } from "node:os";
import path from "node:path";

function defaultStateDirectory(): string {
  const xdgState = Bun.env["XDG_STATE_HOME"];
  const stateBase =
    xdgState === undefined || xdgState.length === 0
      ? path.join(homedir(), ".local", "state")
      : xdgState;
  return path.join(stateBase, "pr-fleet-controller");
}

export function resolveStateDirectory(stateDirectory?: string): string {
  return path.resolve(stateDirectory ?? defaultStateDirectory());
}
