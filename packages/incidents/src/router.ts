/**
 * `@shepherdjerred/incidents/router`: the tRPC router type for typed clients
 * (`toolkit incident`, Hub's incidents pages). Type-only; importing it pulls
 * in no server code at runtime.
 */
import type { IncidentsRouter as ServerRouter } from "#server/router.ts";

export type IncidentsRouter = ServerRouter & {
  readonly __wireContract?: never;
};
