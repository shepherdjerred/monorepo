import {
  CiDashboardSampleSchema,
  CiTimingHistorySchema,
  estimateCiDashboard,
  isCiSampleStale,
  type CiDashboardResponse,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { PrismaCiDashboardRepository } from "#infrastructure/prisma-ci-dashboard-repository";
import { hasBearer } from "#server/bearer";
import { JsonTextSchema } from "#shared/json-text";
import { toContractDate, type Clock } from "#shared/time";

export type CiDashboardOptions = {
  repository: Pick<
    PrismaCiDashboardRepository,
    "getSample" | "getTimings" | "storeSample" | "storeTimings"
  >;
  enabled: () => Promise<boolean>;
  clock: Clock;
};

const emptyEstimates = { runs: {}, workflows: {} };

export function registerCiDashboardRoutes(
  app: Hono,
  { clock, enabled, repository }: CiDashboardOptions,
  token: string,
): void {
  const authenticate: MiddlewareHandler = async (context, next) =>
    hasBearer(context.req.header("authorization"), token)
      ? next()
      : context.json({ error: "Unauthorized" }, 401);
  const limit = bodyLimit({
    maxSize: 1024 * 1024,
    onError: (context) => context.json({ error: "Payload too large" }, 413),
  });

  app.get("/api/v1/ops/ci", async (context) => {
    context.header("Cache-Control", "no-store");
    const isEnabled = await enabled();
    const response: CiDashboardResponse = {
      enabled: isEnabled,
      sample: null,
      stale: false,
      unavailableSources: [],
      estimates: emptyEstimates,
    };
    if (!isEnabled) return context.json(response);

    const entry = await repository.getSample();
    if (entry === null) return context.json(response);

    const { sample, unavailableSources } = entry;
    const now = toContractDate(clock.now());
    const stale =
      isCiSampleStale(sample.sampledAt, now) ||
      (sample.jobs !== null && isCiSampleStale(sample.jobs.sampledAt, now));
    const mayEstimate =
      !stale &&
      !unavailableSources.includes("jobs") &&
      !unavailableSources.includes("queue");
    const history = mayEstimate ? await repository.getTimings() : null;
    return context.json({
      ...response,
      sample,
      stale,
      unavailableSources,
      estimates:
        history === null
          ? emptyEstimates
          : estimateCiDashboard(sample, history, now),
    } satisfies CiDashboardResponse);
  });

  app.post("/internal/v1/ops/ci", authenticate, limit, async (context) => {
    const sample = CiDashboardSampleSchema.parse(
      JsonTextSchema.parse(await context.req.text()),
    );
    const stored = await repository.storeSample(
      sample,
      clock.now().epochNanoseconds,
    );
    return context.json({ stored }, 202);
  });

  app.get("/internal/v1/ops/ci/timings", authenticate, async (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(await repository.getTimings());
  });

  app.post(
    "/internal/v1/ops/ci/timings",
    authenticate,
    limit,
    async (context) => {
      const history = CiTimingHistorySchema.parse(
        JsonTextSchema.parse(await context.req.text()),
      );
      const stored = await repository.storeTimings(
        history,
        clock.now().epochNanoseconds,
      );
      return context.json({ stored }, 202);
    },
  );
}
