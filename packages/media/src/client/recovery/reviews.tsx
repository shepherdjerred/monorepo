import type { z } from "zod";
import type { RecoveryListSchema } from "#shared/recovery.ts";
import type { MediaUser } from "#shared/contract.ts";
import { dateLabel } from "#client/components.tsx";
import {
  isWaitingState,
  reviewStateCopy,
} from "#client/presentation/recovery.ts";
import { ButtonLink } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
} from "#client/ui/panel.tsx";
import { InlineTitles } from "./parts.tsx";
import { reviewPath } from "./paths.ts";

type Review = z.infer<typeof RecoveryListSchema>["reviews"][number];

function stateBadge(state: string) {
  const copy = reviewStateCopy(state);
  return <Badge tone={copy.tone}>{copy.label}</Badge>;
}

function ReviewRows({
  reviews,
  action,
}: {
  reviews: readonly Review[];
  action: string;
}) {
  return (
    <DataList label="Household reviews">
      {reviews.map((review) => (
        <DataRow
          key={review.id}
          title={<InlineTitles titles={review.titles} />}
          detail={`Prepared ${dateLabel(review.createdAt)}. ${String(review.titles.length)} ${review.titles.length === 1 ? "title" : "titles"}.`}
          status={stateBadge(review.state)}
          actions={<ButtonLink to={reviewPath(review.id)}>{action}</ButtonLink>}
        />
      ))}
    </DataList>
  );
}

/**
 * The household reviews a reader can open: the ones still waiting for
 * declarations first, then, folded away, the ones already applied.
 */
export function ReviewsPanel({
  user,
  reviews,
  id,
}: {
  user: MediaUser;
  reviews: readonly Review[];
  id?: string;
}) {
  const owner = user.role === "owner";
  const waiting = reviews.filter((review) => isWaitingState(review.state));
  const finished = reviews.filter((review) => !isWaitingState(review.state));
  return (
    <Panel
      title="Household reviews"
      {...(id === undefined ? {} : { id })}
      description={
        owner
          ? "A household review captures the titles a restore left protected. Each person says what they still want, then you apply it. Titles stay protected until you do."
          : "Titles that stay protected until everyone has said what they still want. Open a review to say what you want for yours."
      }
    >
      {reviews.length === 0 && (
        <EmptyNote>
          {owner
            ? "There are no household reviews. Prepare one from the held titles."
            : "No reviews need your response."}
        </EmptyNote>
      )}
      {reviews.length > 0 && waiting.length === 0 && (
        <Callout tone="ok" title="Nothing is waiting">
          {owner
            ? "Every household review has been applied."
            : "No review is waiting for a declaration."}
        </Callout>
      )}
      {waiting.length > 0 && (
        <ReviewRows
          reviews={waiting}
          action={owner ? "Open review" : "Open review and respond"}
        />
      )}
      {finished.length > 0 && (
        <DisclosureList>
          <Disclosure
            title={`Applied reviews (${String(finished.length)})`}
            meta="Nothing left to do on these"
          >
            <ReviewRows reviews={finished} action="View review" />
          </Disclosure>
        </DisclosureList>
      )}
    </Panel>
  );
}
