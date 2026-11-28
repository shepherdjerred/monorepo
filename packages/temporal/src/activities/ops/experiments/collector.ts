import { z } from "zod";
import {
  APP_HOSTS,
  EXPERIMENTS_REVIEW_PATH,
} from "@shepherdjerred/ops-model/tool-links.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type { OpsCollection } from "#activities/ops/ops-types.ts";

const ReviewSummary = z.strictObject({ dueCount: z.int().nonnegative() });
const TIMEOUT_MS = 5000;

export async function collectExperiments(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<OpsCollection> {
  const response = await fetchImpl(
    new URL("/internal/v1/review-summary", baseUrl),
    { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" },
  );
  if (!response.ok) {
    throw new Error(
      `Experiments review summary returned ${String(response.status)}`,
    );
  }
  const { dueCount } = ReviewSummary.parse(await response.json());
  return {
    signals:
      dueCount === 0
        ? []
        : [
            {
              id: "experiments:due-for-review",
              source: "experiments",
              section: "work",
              kind: "experiments-due",
              severity: "info",
              needsMe: true,
              title:
                dueCount === 1
                  ? "1 experiment due for review"
                  : `${String(dueCount)} experiments due for review`,
              attributes: { dueCount },
              links: [
                {
                  kind: "hub",
                  label: "Review experiments",
                  url: new URL(
                    EXPERIMENTS_REVIEW_PATH,
                    APP_HOSTS.hub,
                  ).toString(),
                },
              ],
            },
          ],
    metrics: [],
    changes: [],
  };
}
