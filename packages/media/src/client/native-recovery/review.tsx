import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativeRecoveryDetailProtocolSchema,
  type SeriesPackNativeDetailV1,
} from "#shared/native-recovery/series-pack/detail.ts";
import { readApi } from "#client/api.ts";
import { useNativeReviewApproval } from "./approval.ts";
import { reviewState } from "./vocabulary.ts";
import { PublishedReview } from "./published.tsx";
import { QuarantineFileReview } from "./quarantine-review.tsx";
import { ReviewHeader } from "./shell.tsx";
import { NativeArchiveReview } from "./archive/review.tsx";
import { NativeCompensationReview } from "./compensation/review.tsx";
import { SeriesPackNativeReview } from "./series-pack/review.tsx";
import {
  nativeReviewIdentity,
  nativeReviewAcknowledged,
} from "./acknowledgement.ts";
import type { z } from "zod";
import { SkeletonRows } from "#client/ui/panel.tsx";

export function NativeRecoveryReview({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ["native-recovery-detail", id],
    queryFn: async () => {
      const read = await readApi(
        `/admin/native-recovery/${id}`,
        NativeRecoveryDetailProtocolSchema,
      );
      reviewState(read.state);
      return read;
    },
    refetchInterval: (query) => {
      const review = query.state.data;
      return review !== undefined && "protocol" in review
        ? seriesPackReviewInterval(review)
        : reviewInterval(review);
    },
  });
  const acknowledged = nativeReviewAcknowledged(acknowledgement, result.data);
  const setAcknowledged = (checked: boolean) => {
    setAcknowledgement(checked ? nativeReviewIdentity(result.data) : null);
  };
  const apply = useNativeReviewApproval({
    user,
    id,
    acknowledgement,
    onSuccess: async () => {
      await result.refetch();
    },
  });
  const review = result.data;
  if (review !== undefined && "protocol" in review)
    return (
      <SeriesPackNativeReview
        user={user}
        review={review}
        acknowledgement={acknowledgement}
        onAcknowledge={setAcknowledged}
        onRefresh={() => result.refetch()}
        refreshing={result.isFetching}
        error={result.error}
      />
    );
  const compensation = compensationSelection(review);
  const archiveScope = archiveSelection(review);
  if (compensation !== null || archiveScope !== null) {
    const legacy = {
      acknowledged,
      onAcknowledge: setAcknowledged,
      onApply: () => {
        apply.mutate();
      },
      pending: apply.isPending,
      error: apply.error ?? result.error,
      onRefresh: () => {
        void result.refetch();
      },
      refreshing: result.isFetching,
    };
    if (compensation !== null)
      return (
        <NativeCompensationReview
          user={user}
          review={compensation.review}
          scope={compensation.scope}
          {...legacy}
        />
      );
    if (archiveScope !== null && review !== undefined)
      return (
        <NativeArchiveReview review={review} scope={archiveScope} {...legacy} />
      );
  }
  if (review !== undefined && quarantineSelection(review))
    return (
      <QuarantineFileReview
        review={review}
        loading={result.isPending}
        loadError={result.error}
        applyError={apply.error}
        applying={apply.isPending}
        onApply={() => {
          apply.mutate();
        }}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        subtitlePolicies={reviewSubtitlePolicies(review)}
        quarantined
      />
    );
  const header = {
    onRefresh: () => {
      void result.refetch();
    },
    refreshing: result.isFetching,
    loadError: result.error,
  };
  if (review === undefined)
    return result.isPending ? (
      <SkeletonRows label="Loading the review" rows={4} tall />
    ) : (
      <ReviewHeader
        title="Recover selected file ownership"
        intro="File checks prove these physical versions."
        back={{
          to: "/manage/recovery/native",
          label: "All native recovery reviews",
        }}
        refreshLabel="Refresh review"
        {...header}
      />
    );
  return (
    <PublishedReview
      review={review}
      subtitlePolicies={reviewSubtitlePolicies(review)}
      approval={{
        acknowledged,
        onAcknowledge: setAcknowledged,
        onApply: () => {
          apply.mutate();
        },
        pending: apply.isPending,
        error: apply.error,
      }}
      header={header}
    />
  );
}

function reviewSubtitlePolicies(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  return review !== undefined && "subtitlePolicies" in review.scope
    ? review.scope.subtitlePolicies
    : [];
}

function seriesPackReviewInterval(review: SeriesPackNativeDetailV1) {
  return ["preparing", "applying"].includes(review.state) ||
    review.compensationContinuations.some(
      (item) =>
        item.state === "pending" ||
        item.state === "compensating" ||
        item.publicationState === "publishing",
    )
    ? 5000
    : false;
}

function compensationSelection(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  if (review === undefined) return null;
  const scope = review.scope;
  return scope.schemaVersion === 2 &&
    scope.lifecycleKind === "publication_compensation"
    ? { scope, review }
    : null;
}

function archiveSelection(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  const scope = review?.scope;
  return scope?.schemaVersion === 2 &&
    scope.lifecycleKind === "superseded_archive"
    ? scope
    : null;
}

function quarantineSelection(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  return (
    review?.scope.schemaVersion === 2 &&
    review.scope.lifecycleKind === "committed_quarantine"
  );
}

function reviewInterval(
  review: z.infer<typeof NativeLifecycleDetailSchema> | undefined,
) {
  if (
    review?.compensationContinuations?.some(
      (item) =>
        item.state === "pending" ||
        item.state === "compensating" ||
        item.publicationState === "publishing",
    ) === true
  )
    return 5000;
  if (
    ["preparing", "applying"].includes(review?.state ?? "") ||
    review?.continuations.some(
      (item) =>
        item.state === "restoring" ||
        (item.state === "restored" &&
          item.media.some((media) => media.availability === "importing")),
    ) === true
  )
    return 5000;
  return review?.archiveContinuations?.some(
    (item) => item.state === "pending" || item.state === "cleaning",
  ) === true
    ? 15_000
    : false;
}
