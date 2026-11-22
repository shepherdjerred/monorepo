import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  RecoveryDetailSchema,
  isRecoveryScopeV2,
  type RecoveryDetail,
} from "#shared/recovery.ts";
import { readApi } from "#client/api.ts";
import { dateLabel, PageTitle } from "#client/components.tsx";
import {
  blockerSentence,
  isWaitingState,
  reviewStateCopy,
} from "#client/presentation/recovery.ts";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { ClaimEvidencePanel } from "./claims.tsx";
import { DeclarationPanels } from "./declare.tsx";
import { BackLink, Plain, StatusStack, TitleList } from "./parts.tsx";
import { recoveryPath } from "./paths.ts";
import { ReleasePanel } from "./release.tsx";

/** The headline of the waiting state: who the review waits for, or that it is ready. */
function standingTitle(
  user: MediaUser,
  review: RecoveryDetail,
  missing: readonly { displayName: string }[],
): string {
  if (user.role !== "owner") {
    return review.missingUserIds.includes(user.id)
      ? "Your declaration is still needed"
      : "Your declaration is recorded";
  }
  return missing.length === 0
    ? "Everyone has declared. It is ready for you to apply."
    : `Waiting for ${missing.map((person) => person.displayName).join(", ")}`;
}

/** Where the review stands, and what it is waiting for, before anything else. */
function Standing({
  user,
  review,
}: {
  user: MediaUser;
  review: RecoveryDetail;
}) {
  const owner = user.role === "owner";
  const waiting = isWaitingState(review.state);
  const blockers = review.scope.blockers;
  const missing = review.scope.users.filter((person) =>
    review.missingUserIds.includes(person.id),
  );
  const expired = waiting && Date.parse(review.expiresAt) <= Date.now();
  const ready = owner && missing.length === 0 && blockers.length === 0;
  const tone = ready ? "ok" : blockers.length > 0 ? "neutral" : "warn";
  if (!waiting) {
    return (
      <StatusStack>
        <Callout tone="ok" title="This review was applied">
          Reviewed declarations were applied and only the listed recovery holds
          were released. Existing pins, fresh watch checks and normal
          warning/grace rules still apply.
        </Callout>
      </StatusStack>
    );
  }
  return (
    <StatusStack>
      {blockers.map((blocker) => (
        <Callout key={blocker} tone="warn" title={blockerSentence(blocker)}>
          This review cannot release protection until the owner resolves the
          missing evidence and prepares a new review.
        </Callout>
      ))}
      {expired && (
        <Callout tone="warn" title="This review has expired">
          Reviews expire after seven days. Ask the owner to prepare a new
          review.
        </Callout>
      )}
      <Callout tone={tone} title={standingTitle(user, review, missing)}>
        Recovery protection remains in place. No pending declaration has changed
        requests or Keep yet.
      </Callout>
    </StatusStack>
  );
}

/** One household review: what it covers, who has declared, and what happens next. */
export function RecoveryReviewPage({
  user,
  id,
}: {
  user: MediaUser;
  id: string;
}) {
  const result = useQuery({
    queryKey: ["recovery", id],
    queryFn: () => readApi(`/recovery/reviews/${id}`, RecoveryDetailSchema),
  });
  const review = result.data;
  const owner = user.role === "owner";
  const state = review === undefined ? null : reviewStateCopy(review.state);
  return (
    <>
      <PageTitle title="Review protected titles">
        <p>
          Your declaration stays pending until the owner applies the exact
          household review. To protect something immediately, use its existing
          Keep or pin action; that will require a fresh review.
        </p>
      </PageTitle>
      <BackLink to={recoveryPath(user)}>All recovery reviews</BackLink>
      {result.isPending && <SkeletonRows label="Loading review" rows={4} />}
      {result.error !== null && (
        <StatusStack>
          <LoadError
            what="This review"
            error={result.error}
            retry={() => {
              void result.refetch();
            }}
          />
        </StatusStack>
      )}
      {review !== undefined && state !== null && (
        <>
          <Standing user={user} review={review} />
          <Panel
            title="Affected titles"
            description={
              <>
                <Badge tone={state.tone}>{state.label}</Badge>{" "}
                {isWaitingState(review.state)
                  ? `Expires ${dateLabel(review.expiresAt)}.`
                  : ""}
              </>
            }
          >
            <TitleList
              label="titles"
              limit={12}
              titles={review.scope.media.map((media) => ({
                key: media.id,
                title: media.title,
                to: `/media/${media.id}`,
              }))}
            />
            {review.scope.media.length === 0 && (
              <Plain>No title in this review is open to you.</Plain>
            )}
          </Panel>
          <DeclarationPanels user={user} review={review} />
          {owner &&
            isRecoveryScopeV2(review.scope) &&
            review.scope.legacyClaims.length > 0 && (
              <ClaimEvidencePanel
                review={review}
                claims={review.scope.legacyClaims}
              />
            )}
          {owner && <ReleasePanel user={user} review={review} />}
        </>
      )}
    </>
  );
}
