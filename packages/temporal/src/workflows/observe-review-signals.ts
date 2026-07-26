import { proxyActivities } from "@temporalio/workflow";
import type {
  ObserveReviewSignalsActivities,
  ObserveReviewSignalsInput,
  ObserveReviewSignalsResult,
} from "#activities/observe-review-signals.ts";

const { runObserveReviewSignals } =
  proxyActivities<ObserveReviewSignalsActivities>({
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "30 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "10s",
      backoffCoefficient: 2,
      maximumInterval: "60s",
    },
  });

/**
 * Scans recent PRs, computes each PR's code-review signal via
 * `@shepherdjerred/code-review` (provider-neutral — same model the
 * `review-gate` CI step uses), records Prometheus metrics, and appends the
 * signals as NDJSON to S3 — a durable longitudinal dataset of "what the
 * review bot did and when". See src/activities/observe-review-signals.ts.
 */
export async function observeReviewSignalsWorkflow(
  input: ObserveReviewSignalsInput = {},
): Promise<ObserveReviewSignalsResult> {
  return runObserveReviewSignals(input);
}
