import type { Context } from "hono";
import type { Pipeline } from "#src/schemas.ts";
import { resolveCiImages, type ImageFetcher } from "#src/images.ts";
import {
  DISABLED_PERFORMANCE,
  type PerformanceOptions,
} from "#src/performance-config.ts";
import { benchmarkRequest, benchmarkSteps } from "./benchmark.ts";
import { emitWorkflows } from "./emit.ts";
import { routeSteps } from "./routing.ts";

export async function benchmarkResponse(
  context: Context,
  options: {
    imageFetcher: ImageFetcher;
    performanceOptions?: (branch: string) => Promise<PerformanceOptions>;
    trustedGateImage?: string;
  },
  pipeline: Pipeline,
  identity: { defaultBranch: string; owner: boolean },
) {
  let benchmark;
  try {
    benchmark = benchmarkRequest(
      pipeline,
      identity.defaultBranch,
      identity.owner,
    );
  } catch {
    return context.json(
      { error: "invalid performance benchmark request" },
      400,
    );
  }
  if (benchmark === undefined) return;
  const images = await resolveCiImages(pipeline.commit, options.imageFetcher);
  const performance =
    (await options.performanceOptions?.("ci-canary/performance")) ??
    DISABLED_PERFORMANCE;
  try {
    const selected = benchmarkSteps(
      images,
      benchmark,
      performance,
      options.trustedGateImage,
    );
    return context.json({
      configs: emitWorkflows(
        routeSteps(selected, {
          event: "manual",
          branch: pipeline.branch,
          defaultBranch: identity.defaultBranch,
          draft: false,
          maintenance: true,
        }),
        {
          commit: pipeline.commit,
          branch: pipeline.branch,
          linkUrl: pipeline.forge_url,
          event: pipeline.event,
        },
      ),
    });
  } catch {
    return context.json({ error: "benchmark candidate unavailable" }, 403);
  }
}
