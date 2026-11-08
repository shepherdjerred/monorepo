import type { z } from "zod";
import type { MediaActor } from "./auth.ts";
import type {
  PrepareMovieHistoryV3Schema,
  RespondMovieHistoryV3Schema,
  ReleaseMovieHistoryV3Schema,
  MovieHistoryCommandResultV3Schema,
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type {
  MovieHistoryDiscoveryV3Schema,
  MovieHistoryPendingV3Schema,
} from "#shared/movie-editions/history-review-views-v3.ts";

type Result = z.infer<typeof MovieHistoryCommandResultV3Schema>;
/** Application contract; storage and current Plex authorization remain behind the service. */
export type MovieHistoryAdministration = {
  context: (
    actor: MediaActor,
    scope: MovieEditionScope,
  ) => Promise<z.infer<typeof PrepareMovieHistoryV3Schema>>;
  list: (
    actor: MediaActor,
    input: z.input<typeof MovieHistoryDiscoveryV3Schema>,
  ) => Promise<z.infer<typeof MovieHistoryPendingV3Schema>>;
  detail: (
    actor: MediaActor,
    id: string,
  ) => Promise<
    | z.infer<typeof MovieHistoryDetailV3Schema>
    | z.infer<typeof MovieHistoryPersonalDetailV3Schema>
  >;
  prepare: (
    actor: MediaActor,
    key: string,
    input: z.input<typeof PrepareMovieHistoryV3Schema>,
  ) => Promise<Result>;
  respond: (
    actor: MediaActor,
    key: string,
    id: string,
    input: z.input<typeof RespondMovieHistoryV3Schema>,
  ) => Promise<Result>;
  release: (
    actor: MediaActor,
    key: string,
    id: string,
    input: z.input<typeof ReleaseMovieHistoryV3Schema>,
  ) => Promise<Result>;
};
