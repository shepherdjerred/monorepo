import type { z } from "zod";
import type { MediaActor } from "./auth.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieSubtitleTargetV2 } from "#shared/movie-editions/subtitle-target-v2.ts";
import type {
  MovieManualReplacementV2Schema,
  MoviePrepareReplacementV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import type { CommandResultSchema } from "#shared/api.ts";

export type MovieSubtitleReplacementAdministrationV2 = {
  context: (
    actor: MediaActor,
    scope: MovieEditionScope,
  ) => Promise<MovieSubtitleTargetV2>;
  upload: (
    actor: MediaActor,
    key: string,
    input: z.input<typeof MovieManualReplacementV2Schema>,
  ) => Promise<z.infer<typeof CommandResultSchema>>;
  prepare: (
    actor: MediaActor,
    key: string,
    input: z.input<typeof MoviePrepareReplacementV2Schema>,
  ) => Promise<z.infer<typeof CommandResultSchema>>;
};
