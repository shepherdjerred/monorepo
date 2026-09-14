import {
  getScoutTemporalHealth,
  type ScoutTemporalHealth,
} from "#src/temporal/health.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";

/**
 * Whether a durable start would actually be accepted right now.
 *
 * The supervisor being INSTALLED is not the question. It stays installed across
 * its whole reconnect loop — that loop is what it exists to run — so a process
 * whose connection has dropped still has one, and `client()` throws for exactly
 * that case. A surface that read the supervisor's presence as availability
 * would offer an operator start arms whose only possible outcome is a throw.
 *
 * So both facts are required: a supervisor to start through, and a connection
 * it is currently holding. `starting`, `degraded` and `stopping` all report
 * unavailable, which is the honest answer in each — work may become startable
 * later, but it is not startable now.
 */
export function startsAvailable(args: {
  supervisorInstalled: boolean;
  health: ScoutTemporalHealth["state"];
}): boolean {
  return args.supervisorInstalled && args.health === "connected";
}

export function scoutTemporalStartsAvailable(): boolean {
  return startsAvailable({
    supervisorInstalled: currentScoutTemporalSupervisor() !== undefined,
    health: getScoutTemporalHealth().state,
  });
}
