import { useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { PageTitle } from "#client/components.tsx";
import { MovieHistoryIndexV3 } from "#client/movie-history/index.tsx";
import { LoadError } from "#client/ui/feedback.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { StatusStack } from "./parts.tsx";
import { useRecoveryList } from "./reads.ts";
import { RecoveryReviewPage } from "./review-page.tsx";
import { ReviewsPanel } from "./reviews.tsx";

/**
 * A household member's recovery reviews: the ones to answer, and the movie
 * edition reviews. The owner works from Manage, which `/recovery` sends them
 * to, so this page is the member's.
 */
export function RecoveryPage({ user }: { user: MediaUser }) {
  const result = useRecoveryList();
  return (
    <>
      <PageTitle title="Recovery reviews">
        <p>
          Restored files cannot tell us who requested them or asked to keep them
          after a backup. These titles stay protected until the household states
          its present intent.
        </p>
      </PageTitle>
      {result.isPending && (
        <Panel title="Household reviews">
          <SkeletonRows label="Loading reviews" rows={3} />
        </Panel>
      )}
      {result.error !== null && (
        <StatusStack>
          <LoadError
            what="Your reviews"
            error={result.error}
            retry={() => {
              void result.refetch();
            }}
          />
        </StatusStack>
      )}
      {result.data !== undefined && (
        <ReviewsPanel user={user} reviews={result.data.reviews} />
      )}
      <MovieHistoryIndexV3 user={user} />
    </>
  );
}

/** One review, from a link in a message or from the list. */
export function RecoveryReview({ user }: { user: MediaUser }) {
  const { id } = useParams();
  if (id === undefined) throw new Error("A review route requires its id");
  return <RecoveryReviewPage key={`${user.id}:${id}`} user={user} id={id} />;
}
