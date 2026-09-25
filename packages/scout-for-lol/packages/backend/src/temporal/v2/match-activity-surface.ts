import type { ScoutTemporalV2Activities } from "@scout-for-lol/temporal/activities";

/**
 * The nine Activities of the V2 post-match core, as a TYPE and nothing else.
 *
 * This is a type-only module on purpose, and the purpose is the import graph
 * rather than tidiness. `connected-runtime.ts` needs this shape to describe
 * the realtime worker's activity group, and `connected-runtime.ts` is reachable
 * from the tRPC router — which the browser apps import for `AppRouter`. When
 * the type lived beside the factory, asking for it dragged the factory in, and
 * the factory's `await import(...)` calls are type edges even though they are
 * not runtime edges: the whole V2 implementation, the v1 post-match slice
 * behind it, and the betting and Discord presentation code behind THAT all
 * entered `@scout-for-lol/app`'s and `@scout-for-lol/activity`'s type programs.
 *
 * That is not merely wasteful. Backend sources are typechecked under the
 * backend's own tsconfig, whose `src/reset.d.ts` loads `@total-typescript/ts-reset`;
 * a browser app's tsconfig includes only its own `src/**`, so the reset is
 * absent and backend code relying on it stops compiling. Keeping the type here
 * keeps the factory reachable only from `activities.ts`, which no other
 * package's program includes.
 */
export type ScoutV2MatchActivities = Pick<
  ScoutTemporalV2Activities,
  | "resolvePostMatchDiscoveryOwnerV2"
  | "releasePostMatchPollClaimV2"
  | "renewPostMatchPollClaimV2"
  | "discoverPostMatchIdsV2"
  | "readMatchPipelineStateV2"
  | "readLegacyMatchCompletionV2"
  | "archiveMatchArtifactsV2"
  | "commitMatchObservationV2"
  | "settleMatchMarketsV2"
  | "applyMatchProgressionV2"
  | "finalizeTournamentResultV2"
  | "recordMatchReceiptsV2"
  | "recordClientMatchTerminalV2"
  | "advanceMatchCursorV2"
  | "mintPostmatchNotificationIntentsV2"
  | "planMatchFanOutV2"
>;
