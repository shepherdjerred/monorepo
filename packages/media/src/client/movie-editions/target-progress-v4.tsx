import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { Transfers } from "#client/media-progress/panel.tsx";
import { Callout } from "#client/ui/feedback.tsx";
import { Disclosure, DisclosureList } from "#client/ui/panel.tsx";

export function MovieEditionProgressV4({
  context,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
}) {
  const progress = context.progress;
  if (progress === null) return null;
  return (
    <DisclosureList>
      <Disclosure title={`Download and seeding for ${context.editionLabel}`}>
        <Transfers
          attempts={progress.attempts}
          torrents={progress.torrents}
          empty={
            progress.attempts.length === 0
              ? "No recorded transfers for this edition."
              : "No downloads are recorded for this edition. Its attempts are listed below."
          }
        />
        {progress.historyTruncated && (
          <Callout tone="warn">
            Showing a bounded portion of this edition’s recorded history.
          </Callout>
        )}
      </Disclosure>
    </DisclosureList>
  );
}
