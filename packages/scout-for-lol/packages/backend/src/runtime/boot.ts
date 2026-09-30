/**
 * The composition root: turn a runtime role into a running process.
 *
 * This is role-generic on purpose. It reads the capability table, asks
 * `plan.ts` for the ordered steps, and calls one injected action per step —
 * every decision about *what* a role runs lives in the table, and every
 * decision about *how* lives in `subsystems.ts`. Nothing here branches on a
 * role name, so a role cannot acquire a subsystem by accident.
 */

import {
  scoutRuntimeCapabilities,
  type ScoutRuntimeRole,
} from "#src/configuration/runtime-role.ts";
import { createLogger } from "#src/logger.ts";
import {
  runScoutBootSteps,
  runScoutShutdownSteps,
  scoutBootSteps,
  scoutShutdownSteps,
  type ScoutBootActions,
  type ScoutShutdownActions,
} from "#src/runtime/plan.ts";

const logger = createLogger("runtime");

export type ScoutRuntimeDependencies = {
  /**
   * Give this process a usable Discord REST client, and — on a role with no
   * gateway — mark the gateway deliberately absent.
   *
   * The second half is not cosmetic. The gateway health singleton starts at
   * `connecting`, and `/livez` fails a process whose shard has never
   * acknowledged a heartbeat once the startup grace period expires. A role that
   * simply skips the login without saying so crash-loops five minutes after it
   * comes up.
   */
  readonly prepareDiscord: (input: { ownsGateway: boolean }) => Promise<void>;
  /** Compose the scrape-time collector set for this role. */
  readonly configureMetricSweeps: (enabled: boolean) => void;
  readonly boot: ScoutBootActions;
  readonly shutdown: ScoutShutdownActions;
};

export type ScoutRuntime = {
  readonly shutdown: () => Promise<void>;
};

export async function startScoutRuntime(
  role: ScoutRuntimeRole,
  dependencies: ScoutRuntimeDependencies,
): Promise<ScoutRuntime> {
  const capabilities = scoutRuntimeCapabilities(role);
  const bootSteps = scoutBootSteps(capabilities);
  const shutdownSteps = scoutShutdownSteps(capabilities);

  logger.info(`🎛️  Scout runtime role: ${role}`, {
    role,
    bootSteps,
    httpSurface: capabilities.httpSurface,
    temporalWorkers: capabilities.temporalWorkers,
    deferredTemporalWorkers: capabilities.deferredTemporalWorkers,
    databaseMetricSweeps: capabilities.databaseMetricSweeps,
  });

  dependencies.configureMetricSweeps(capabilities.databaseMetricSweeps);
  await dependencies.prepareDiscord({
    ownsGateway: capabilities.discordGateway,
  });
  await runScoutBootSteps(bootSteps, dependencies.boot);

  logger.info(`✅ Scout runtime ready (role: ${role})`);

  return {
    shutdown: async () => {
      await runScoutShutdownSteps(shutdownSteps, dependencies.shutdown);
    },
  };
}
