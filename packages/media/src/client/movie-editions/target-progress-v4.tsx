import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { dateLabel } from "#client/components.tsx";
import { TorrentProgress } from "#client/media-progress/panel.tsx";
import { attemptLabel } from "#client/media-progress/presentation.ts";

export function MovieEditionProgressV4({
  context,
}: {
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
}) {
  const progress = context.progress;
  if (progress === null) return null;
  return (
    <details>
      <summary>Download & seeding for {context.editionLabel}</summary>
      {progress.attempts.length === 0 && progress.torrents.length === 0 && (
        <p className="helper">No recorded transfers for this edition.</p>
      )}
      <div className="download-grid">
        {progress.torrents.map((torrent, index) => (
          <TorrentProgress
            key={torrent.id}
            torrent={torrent}
            number={index + 1}
          />
        ))}
      </div>
      {progress.attempts.length > 0 && (
        <ol className="acquisition-history">
          {progress.attempts.map((attempt) => (
            <li key={attempt.id}>
              <strong>{attemptLabel(attempt.state)}</strong>
              <p className="helper">
                Started {dateLabel(attempt.createdAt)}
                {attempt.currentEpoch ? "" : " · Recorded before recovery"}
              </p>
            </li>
          ))}
        </ol>
      )}
      {progress.historyTruncated && (
        <p className="helper">
          Showing a bounded portion of this edition’s recorded history.
        </p>
      )}
    </details>
  );
}
