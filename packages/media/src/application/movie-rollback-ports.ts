import type { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieRollbackViewV1 } from "#shared/movie-editions/rollback/view.ts";
import type {
  RequestMovieRollbackV1,
  RequestMovieRollbackResultV1Schema,
} from "#shared/movie-editions/rollback/manual-command.ts";
import type {
  RequestMovieRollbackRetryV1,
  RequestMovieRollbackRetryResultV1Schema,
} from "#shared/movie-editions/rollback/retry.ts";

export type MovieRollbackAdministrationV1 = {
  read: (
    actor: MediaActor,
    scope: MovieEditionScope,
  ) => Promise<MovieRollbackViewV1>;
  request: (
    actor: MediaActor,
    key: string,
    input: RequestMovieRollbackV1,
  ) => Promise<z.infer<typeof RequestMovieRollbackResultV1Schema>>;
  retry: (
    actor: MediaActor,
    key: string,
    input: RequestMovieRollbackRetryV1,
  ) => Promise<z.infer<typeof RequestMovieRollbackRetryResultV1Schema>>;
};
