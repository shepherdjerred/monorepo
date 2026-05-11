import { bootstrapActivities } from "./bootstrap.ts";
import { specialistActivities } from "./specialists.ts";
import { consensusActivities } from "./consensus.ts";
import { verifyActivities } from "./verify.ts";
import { dedupeActivities } from "./dedupe.ts";
import { postActivities } from "./post.ts";
import { metricsActivities } from "./metrics.ts";
import { trackActivities } from "./track.ts";
import { ingestDismissalsActivities } from "./ingest-dismissals.ts";

export const prReviewActivities = {
  ...bootstrapActivities,
  ...specialistActivities,
  ...consensusActivities,
  ...verifyActivities,
  ...dedupeActivities,
  ...postActivities,
  ...metricsActivities,
  ...trackActivities,
  ...ingestDismissalsActivities,
};

export type PrReviewActivities = typeof prReviewActivities;
