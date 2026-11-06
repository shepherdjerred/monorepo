import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import type {
  SeriesPackNativeActivityV1,
  SeriesPackNativeReviewV1,
  SeriesPackNativeApplyV1,
} from "./runtime.ts";

/** Process-local actual Files SDK capability, captured by compensationRuntimeCall
 * before lazy runtime loading. It is never part of any Activity input/history. */
export type SeriesPackNativeFileExecutionV1 =
  NativeCompensationExecutionContext & {
    readonly observed: { wall: number; monotonic: number };
  };

export type SeriesPackNativeFileActivitiesV1 = {
  prepareSeriesPackNativeCompensationV1: (
    input: SeriesPackNativeReviewV1,
  ) => Promise<void>;
  applySeriesPackNativeCompensationV1: (
    input: SeriesPackNativeApplyV1,
  ) => Promise<void>;
  compensateSeriesPackNativePublicationV1: (
    input: SeriesPackNativeActivityV1,
  ) => Promise<{ status: "compensated" | "protected"; reason: string | null }>;
};
export type SeriesPackNativeNetworkActivitiesV1 = {
  observeSeriesPackNativeCompensationV1: (
    input: SeriesPackNativeReviewV1,
  ) => Promise<void>;
  observeSeriesPackNativeCompensationExecutionV1: (
    input: SeriesPackNativeActivityV1,
  ) => Promise<{
    status: "ready" | "compensated" | "protected";
    reason: string | null;
  }>;
  seriesPackNativeCompensationStateV1: (
    input: SeriesPackNativeActivityV1,
  ) => Promise<{
    state: "pending" | "compensating" | "protected" | "compensated";
    publicationVerified: boolean;
  }>;
  publishSeriesPackNativeCompensationV1: (
    input: SeriesPackNativeActivityV1,
  ) => Promise<{
    status: "available" | "waiting" | "blocked";
    reason: string | null;
  }>;
};
