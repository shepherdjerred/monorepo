import {
  CiDashboardSampleSchema,
  CiTimingHistorySchema,
  type CiDashboardResponse,
  type CiDashboardSample,
  type CiTimingHistory,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import { z } from "zod";

import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { AsyncMutex } from "#infrastructure/async-mutex";
import { JsonObjectSchema } from "#shared/schema";
import { InstantTextSchema, instantTextToEpochNanoseconds } from "#shared/time";

const SAMPLE_KEY = "ci-dashboard:sample";
const TIMINGS_KEY = "ci-dashboard:timings";
const SourcesSchema = z.enum(["queue", "admission", "jobs"]);
const StoredSampleSchema = z.object({
  sample: CiDashboardSampleSchema,
  unavailableSources: z.array(SourcesSchema),
});

type StoredSample = z.infer<typeof StoredSampleSchema>;

function mergeSample(sample: CiDashboardSample, previous: StoredSample | null) {
  const unavailableSources: CiDashboardResponse["unavailableSources"] =
    SourcesSchema.options.filter((source) => sample[source] === null);
  return {
    sample: {
      sampledAt: sample.sampledAt,
      queue: sample.queue ?? previous?.sample.queue ?? null,
      admission: sample.admission ?? previous?.sample.admission ?? null,
      jobs: sample.jobs ?? previous?.sample.jobs ?? null,
    },
    unavailableSources,
  };
}

/** CI has its own cadence and reuses the latest-only facet storage. */
export class PrismaCiDashboardRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly writeMutex: AsyncMutex,
  ) {}

  async getSample(): Promise<StoredSample | null> {
    const row = await this.prisma.opsFacet.findUnique({
      where: { key: SAMPLE_KEY },
    });
    return row === null ? null : StoredSampleSchema.parse(row.payload);
  }

  async getTimings(): Promise<CiTimingHistory | null> {
    const row = await this.prisma.opsFacet.findUnique({
      where: { key: TIMINGS_KEY },
    });
    return row === null ? null : CiTimingHistorySchema.parse(row.payload);
  }

  async storeSample(sample: CiDashboardSample, receivedAtNs: bigint) {
    return await this.store(SAMPLE_KEY, sample.sampledAt, receivedAtNs, (old) =>
      mergeSample(sample, StoredSampleSchema.nullable().parse(old)),
    );
  }

  async storeTimings(history: CiTimingHistory, receivedAtNs: bigint) {
    return await this.store(
      TIMINGS_KEY,
      history.sampledAt,
      receivedAtNs,
      () => history,
    );
  }

  private async store(
    key: string,
    sampledAt: string,
    receivedAtNs: bigint,
    payload: (previous: unknown) => unknown,
  ): Promise<boolean> {
    const generatedAtNs = instantTextToEpochNanoseconds(
      InstantTextSchema.parse(sampledAt),
    );
    return await this.writeMutex.runExclusive(() =>
      this.prisma.$transaction(async ({ opsFacet }) => {
        const previous = await opsFacet.findUnique({ where: { key } });
        if (previous !== null && previous.generatedAtNs >= generatedAtNs) {
          return false;
        }
        const data = {
          generatedAtNs,
          receivedAtNs,
          payload: JsonObjectSchema.parse(payload(previous?.payload ?? null)),
        };
        await opsFacet.upsert({
          where: { key },
          create: { key, ...data },
          update: data,
        });
        return true;
      }),
    );
  }
}
