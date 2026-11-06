import { z } from "zod";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { MovieRollbackContextV1Schema } from "./manual-command.ts";
import {
  MovieRollbackResumeRefV1Schema,
  MovieRollbackRetryExpectedV1Schema,
} from "./retry.ts";

const Summary = z.strictObject({
  id: z.uuid(),
  version: z.int().nonnegative(),
  quality: z.string(),
  codec: z.string(),
  audioLanguages: z.array(z.string()),
  sizeBytes: z.string().regex(/^[1-9]\d*$/u),
});
const Detail = z.strictObject({
  scope: MovieEditionScopeSchema,
  title: z.string(),
  editionLabel: z.string(),
  predecessor: Summary.nullable(),
  successor: Summary.nullable(),
  originalDeadline: z.iso.datetime().nullable(),
});
const RetryContext = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  sourceAttemptId: z.uuid(),
  resume: MovieRollbackResumeRefV1Schema,
  expected: MovieRollbackRetryExpectedV1Schema,
});
/** Every view carries display-only summaries. Only eligible branches carry CAS. */
export const MovieRollbackViewV1Schema = z.discriminatedUnion("state", [
  Detail.extend({
    state: z.literal("unavailable"),
    reason: z.enum([
      "no_current_movie",
      "no_retained_predecessor",
      "rollback_window_closed",
      "current_pair_protected",
      "playback_scope_unconfigured",
    ]),
    command: z.null(),
  }),
  Detail.extend({
    state: z.literal("request"),
    reason: z.null(),
    command: MovieRollbackContextV1Schema,
  }),
  Detail.extend({
    state: z.literal("retry"),
    reason: z.null(),
    command: RetryContext,
  }),
  Detail.extend({
    state: z.literal("in_progress"),
    reason: z.enum(["workflow_running", "workflow_state_unknown"]),
    command: z.null(),
  }),
  Detail.extend({
    state: z.literal("completed"),
    reason: z.null(),
    command: z.null(),
  }),
]);
export type MovieRollbackViewV1 = z.infer<typeof MovieRollbackViewV1Schema>;
