import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readApi } from "#client/api.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";
import { RequestInterestProgressSchema } from "#shared/household/progress.ts";
import "./progress.css";

export function RequestInterestProgress({
  actorId,
  requestId,
  title,
}: {
  actorId: string;
  requestId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const progress = useQuery({
    queryKey: ["request-interest-progress", actorId, requestId],
    enabled: open,
    queryFn: () =>
      readApi(
        `/request-interests/${encodeURIComponent(requestId)}/progress`,
        RequestInterestProgressSchema,
      ),
  });
  const data = progress.data;
  const labels = {
    following: "Following",
    caught_up: "Caught up — following future episodes",
    complete: "Requested coverage watched",
    released: "Interest released",
    unknown: "Progress not verified",
  };
  const reasons: Record<string, string> = {
    catalog_or_requested_coverage_not_current:
      "Episode information is still being refreshed.",
    requested_coverage_exceeds_observation_bound:
      "This request is too large to verify in one view.",
    requested_coverage_empty:
      "No requested episodes can currently be verified.",
    requester_access_not_current:
      "Plex access needs to be verified before showing viewing progress.",
    current_playback_or_caption_authority_unknown:
      "Current Plex viewing or caption information could not be verified.",
    series_status_not_current:
      "Whether this show is continuing or complete still needs to be verified.",
    following_future_episodes:
      "You are caught up on released episodes and still following this show.",
    required_english_captions_pending:
      "Some titles are waiting for the English captions needed to watch them.",
    requested_content_unavailable:
      "Some requested content has not aired or is not available yet.",
  };
  return (
    <details
      className="interest-progress"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Progress for {title}</summary>
      {open && (
        <div>
          {progress.isPending && <Loading />}
          {progress.error !== null && <ErrorNotice error={progress.error} />}
          {data !== undefined && (
            <>
              <p>{labels[data.status]}</p>
              <dl className="interest-progress-counts">
                {(
                  [
                    ["Requested", data.counts.requested],
                    ["Aired / released", data.counts.released],
                    ["Available to watch", data.counts.available],
                    ["Watched", data.counts.watched],
                    [
                      "Waiting for required captions",
                      data.counts.captionsPending,
                    ],
                  ] as const
                ).map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count?.toLocaleString() ?? "Not verified"}</dd>
                  </div>
                ))}
              </dl>
              {data.reason !== null && (
                <p className="muted">
                  {reasons[data.reason] ?? "This interest has been released."}
                </p>
              )}
              <p className="muted">
                Caught-up shows stay while you’re following them.
              </p>
            </>
          )}
        </div>
      )}
    </details>
  );
}
