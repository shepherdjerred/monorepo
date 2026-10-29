import { useState } from "react";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { MediaActionButton } from "#client/media-actions.tsx";

export function RemovalReview({
  user,
  media,
  context,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: DefaultTargetView;
}) {
  const [review, setReview] = useState<{
    context: DefaultTargetView;
    confirmation: NonNullable<MediaDetail["removalConfirmation"]>;
  } | null>(null);
  return (
    <details
      className="retention-summary"
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          setReview(null);
          return;
        }
        if (media.removalConfirmation !== undefined)
          setReview({ context, confirmation: media.removalConfirmation });
      }}
    >
      <summary>Remove from library</summary>
      <p className="helper">
        This queues an intentional removal and stops acquisition and upgrade
        monitoring. The file remains recoverable during quarantine.
      </p>
      {review === null ? (
        <p className="helper">
          Removal details are unavailable. Refresh this title before confirming
          removal.
        </p>
      ) : (
        <>
          <p>
            These titles share the affected files. Confirm removal of all listed
            titles:
          </p>
          <ul>
            {review.confirmation.media.map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
          <MediaActionButton
            user={user}
            context={review.context}
            action="remove"
            confirmation={review.confirmation}
          />
        </>
      )}
    </details>
  );
}
