import { evalLoadActivities } from "./load.ts";
import { evalReplayActivities } from "./replay.ts";
import { evalGradeActivities } from "./grade.ts";
import { evalPersistActivities } from "./persist.ts";
import { evalRegressionActivities } from "./regression.ts";
import { evalVariantActivities } from "./variant.ts";
import { evalSignificanceActivities } from "./significance.ts";
import { evalDiscordActivities } from "./discord-post.ts";
import { evalExperimentMetricsActivities } from "./experiment-metrics.ts";

export const prReviewEvalActivities = {
  ...evalLoadActivities,
  ...evalReplayActivities,
  ...evalGradeActivities,
  ...evalPersistActivities,
  ...evalRegressionActivities,
  ...evalVariantActivities,
  ...evalSignificanceActivities,
  ...evalDiscordActivities,
  ...evalExperimentMetricsActivities,
};

export type PrReviewEvalActivities = typeof prReviewEvalActivities;
