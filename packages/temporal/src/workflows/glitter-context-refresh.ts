import { proxyActivities } from "@temporalio/workflow";
import type {
  GlitterContextRefreshActivities,
  GlitterContextRefreshInput,
  GlitterContextRefreshResult,
} from "#activities/glitter-context-refresh.ts";

const { refreshGlitterContext } =
  proxyActivities<GlitterContextRefreshActivities>({
    startToCloseTimeout: "90 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

export async function runGlitterContextRefresh(
  input: GlitterContextRefreshInput = {},
): Promise<GlitterContextRefreshResult> {
  return await refreshGlitterContext(input);
}
