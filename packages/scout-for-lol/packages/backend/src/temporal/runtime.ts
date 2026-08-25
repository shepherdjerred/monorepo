import type { ScoutTemporalSupervisor } from "./supervisor.ts";

let supervisor: ScoutTemporalSupervisor | undefined;

export function setScoutTemporalSupervisor(
  value: ScoutTemporalSupervisor | undefined,
): void {
  supervisor = value;
}

export function currentScoutTemporalSupervisor():
  ScoutTemporalSupervisor | undefined {
  return supervisor;
}
