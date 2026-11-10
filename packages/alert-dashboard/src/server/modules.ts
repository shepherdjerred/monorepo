import type { ServerModule } from "#server/platform/module";

/**
 * The server composition root: every module mounted beside the built-in Ops
 * and alert-ledger routes. The client counterpart is `src/client/modules.ts`.
 */
export const serverModules: readonly ServerModule[] = [];
