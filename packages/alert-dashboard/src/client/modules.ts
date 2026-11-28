import { experimentsClientModule } from "../modules/experiments/client.tsx";
import { incidentsClientModule } from "../modules/incidents/client.tsx";
import { tracesClientModule } from "../modules/traces/client.tsx";
import { coreModule } from "./core-module.ts";
import { resolveModules } from "./platform/module.ts";

/**
 * The client composition root: every module the app serves, in navigation
 * order. Adding a module means adding it here and, for its server half, in
 * `src/server/modules.ts`.
 */
export function createClientRegistry(experimentsEnabled: boolean) {
  return resolveModules(
    experimentsEnabled
      ? [
          coreModule,
          incidentsClientModule,
          tracesClientModule,
          experimentsClientModule,
        ]
      : [coreModule, incidentsClientModule, tracesClientModule],
  );
}

const experimentsEnabled =
  typeof document !== "undefined" &&
  document.querySelector('meta[name="hub-experiments"][content="enabled"]') !==
    null;
export const registry = createClientRegistry(experimentsEnabled);
