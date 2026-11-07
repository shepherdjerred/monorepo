import type { MediaActor } from "./auth.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type {
  MovieEditionContextV4,
  MovieEditionRequestListV4,
  MovieTargetContextV4,
  ActivateMovieEditionChoiceV4,
  ActivateMovieEditionChoiceResultV4,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import type {
  MovieRequestV4,
  MovieLifecycleCommandV4,
  MovieLifecycleResultV4,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import type { z } from "zod";
import type {
  CancelMovieRequestV4Schema,
  CancelMovieRequestResultV4Schema,
  RevokeMovieEditionChoiceV4Schema,
  RevokeMovieEditionChoiceResultV4Schema,
  MovieRequestResultV4Schema,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";

/** Distinct public v4 port; historical v3 methods and their stored ACKs remain available separately. */
export type MovieLifecycleApplicationV4 = {
  getMovieEditionContextV4: (
    actor: MediaActor,
    mediaId: string,
    subjectUserId: string,
  ) => Promise<MovieEditionContextV4>;
  listMovieEditionRequestsV4: (
    actor: MediaActor,
    input: { subjectUserId: string; cursor: string | null },
  ) => Promise<MovieEditionRequestListV4>;
  getMovieTargetContextV4: (
    actor: MediaActor,
    scope: MovieEditionScope,
  ) => Promise<MovieTargetContextV4>;
  requestMovieEditionV4: (
    actor: MediaActor,
    key: string,
    input: MovieRequestV4,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<z.infer<typeof MovieRequestResultV4Schema>>;
  cancelMovieEditionRequestV4: (
    actor: MediaActor,
    key: string,
    input: z.infer<typeof CancelMovieRequestV4Schema>,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<z.infer<typeof CancelMovieRequestResultV4Schema>>;
  revokeMovieEditionChoiceV4: (
    actor: MediaActor,
    key: string,
    input: z.infer<typeof RevokeMovieEditionChoiceV4Schema>,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<z.infer<typeof RevokeMovieEditionChoiceResultV4Schema>>;
  activateMovieEditionChoiceV4: (
    actor: MediaActor,
    key: string,
    input: ActivateMovieEditionChoiceV4,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<ActivateMovieEditionChoiceResultV4>;
  executeMovieLifecycleV4: (
    actor: MediaActor,
    key: string,
    input: MovieLifecycleCommandV4,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<MovieLifecycleResultV4>;
};
