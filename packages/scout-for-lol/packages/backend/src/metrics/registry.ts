import { Registry } from "prom-client";

/**
 * The single Prometheus registry all metrics register on. Kept in its own leaf
 * module (no other imports) so metric files can register without creating an
 * import cycle through the large `metrics/index.ts` (which side-effect-imports
 * `usage.ts`, which imports the guild-health gauges).
 */
export const registry = new Registry();
