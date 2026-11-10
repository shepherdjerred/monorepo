import { coreModule } from "./core-module.ts";
import { resolveModules } from "./platform/module.ts";

/**
 * The client composition root: every module the app serves, in navigation
 * order. Adding a module means adding it here and, for its server half, in
 * `src/server/modules.ts`.
 */
export const registry = resolveModules([coreModule]);
