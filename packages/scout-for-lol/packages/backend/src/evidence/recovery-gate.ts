import { resolveEnvironment } from "#src/configuration.ts";
import {
  evidenceRecoveryBootDecision,
  evidenceRecoveryDefault,
} from "#src/config/dynamic.ts";

/**
 * One rollout boundary for the evidence-recovery contract in Riot match
 * processing. Production retains its existing Riot processing contract until
 * `scout-evidence-recovery-enabled` is promoted there.
 *
 * This gate is its own managed key, deliberately independent of
 * `scout_client_ingestion`: lifting the Scout Client production hard-disable
 * must not also switch production's Riot processing for every match.
 *
 * The value is the decision dynamic config captured at boot, so it is read
 * synchronously and never moves while the process runs. A process that never
 * initialized dynamic config (scripts, unit tests) uses the managed default
 * for its environment: on in beta and dev, off in prod.
 */
export function evidenceRecoveryEnabled(): boolean {
  return (
    evidenceRecoveryBootDecision() ??
    evidenceRecoveryDefault({ ENVIRONMENT: resolveEnvironment() })
  );
}
