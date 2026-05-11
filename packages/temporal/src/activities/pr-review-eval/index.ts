import { evalLoadActivities } from "./load.ts";
import { evalReplayActivities } from "./replay.ts";
import { evalGradeActivities } from "./grade.ts";
import { evalPersistActivities } from "./persist.ts";
import { evalRegressionActivities } from "./regression.ts";

export const prReviewEvalActivities = {
  ...evalLoadActivities,
  ...evalReplayActivities,
  ...evalGradeActivities,
  ...evalPersistActivities,
  ...evalRegressionActivities,
};

export type PrReviewEvalActivities = typeof prReviewEvalActivities;
