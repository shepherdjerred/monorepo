import type { RequestedMovieRollbackInputV1 } from "./retry.ts";

export type RequestedMovieRollbackFileActivitiesV1 = {
  prepareRequestedMovieRollbackV1: (
    input: RequestedMovieRollbackInputV1,
  ) => Promise<{
    status: "prepared" | "blocked";
    reason: string | null;
  }>;
  rollbackRequestedMoviePublicationV1: (
    input: RequestedMovieRollbackInputV1,
  ) => Promise<{
    status: "physically_rolled_back" | "blocked";
    reason: string | null;
  }>;
};
export type RequestedMovieRollbackNetworkActivitiesV1 = {
  observeRequestedMovieRollbackV1: (
    input: RequestedMovieRollbackInputV1,
  ) => Promise<{
    status: "ready" | "blocked" | "obsolete";
    reason: string | null;
  }>;
  verifyRequestedMovieRollbackV1: (
    input: RequestedMovieRollbackInputV1,
  ) => Promise<{
    status: "available" | "waiting" | "blocked" | "obsolete";
    reason: string | null;
  }>;
};
