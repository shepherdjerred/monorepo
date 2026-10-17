import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { dateLabel } from "#client/components.tsx";
import { downloadPercent, seededDuration } from "./format.ts";
import {
  attemptLabel,
  observationMessage,
  playbackHeading,
  playbackMessage,
  torrentHeading,
} from "./presentation.ts";
import { SeedingDiagnostics } from "./seeding.tsx";
import "./styles.css";

export function MediaProgress({ visibility }: { visibility: MediaVisibility }) {
  const latest = visibility.attempts[0];
  return (
    <section
      className="panel media-progress"
      aria-labelledby="media-progress-heading"
    >
      <div className="section-heading">
        <h2 id="media-progress-heading">Download & seeding</h2>
        <span>
          {visibility.playback.upgradeInProgress
            ? "Upgrade in progress"
            : "Recorded progress"}
        </span>
      </div>
      <div
        className={`playback-summary ${visibility.playback.playable ? "playback-ready" : ""}`}
      >
        <strong>{playbackHeading(visibility.playback)}</strong>
        <p>{playbackMessage(visibility.playback)}</p>
      </div>
      {latest !== undefined && (
        <p className="latest-acquisition">
          <span className="helper">Latest acquisition record</span>
          <strong>{attemptLabel(latest.state)}</strong>
          {!latest.currentEpoch && (
            <span className="helper">Recorded before recovery</span>
          )}
        </p>
      )}
      {visibility.torrents.length === 0 ? (
        <p className="muted">
          No download observations are available for your current work on this
          title.
        </p>
      ) : (
        <div className="download-grid">
          {visibility.torrents.map((torrent, index) => (
            <TorrentProgress
              key={torrent.id}
              torrent={torrent}
              number={index + 1}
            />
          ))}
        </div>
      )}
      {visibility.attempts.length > 0 && (
        <details className="acquisition-history">
          <summary>Acquisition history ({visibility.attempts.length})</summary>
          <ol>
            {visibility.attempts.map((attempt) => {
              const download = visibility.torrents.findIndex(
                (torrent) => torrent.id === attempt.torrentId,
              );
              return (
                <li key={attempt.id}>
                  <strong>{attemptLabel(attempt.state)}</strong>
                  <p className="helper">
                    Started {dateLabel(attempt.createdAt)}
                    {download === -1
                      ? ""
                      : ` · Download ${String(download + 1)}`}
                    {attempt.currentEpoch ? "" : " · Recorded before recovery"}
                  </p>
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {visibility.historyTruncated && (
        <p className="progress-protection">
          Only a bounded selection is shown. Episode totals and acquisition
          history may be partial.
        </p>
      )}
    </section>
  );
}

function TorrentProgress({
  torrent,
  number,
}: {
  torrent: MediaVisibility["torrents"][number];
  number: number;
}) {
  const fresh = torrent.freshness === "fresh";
  const ratio =
    torrent.ratio === null
      ? "Not observed"
      : torrent.ratio.kind === "infinite"
        ? "∞ (infinite)"
        : torrent.ratio.value.toLocaleString(undefined, {
            maximumFractionDigits: 3,
          });
  return (
    <article className={`download-card ${fresh ? "" : "download-stale"}`}>
      <div className="section-heading">
        <h3>{torrentHeading(torrent)}</h3>
        <span>Download {number}</span>
      </div>
      {torrent.progress !== null && (
        <div className="download-meter">
          <div>
            <span>{fresh ? "Downloaded" : "Last recorded progress"}</span>
            <strong>{downloadPercent(torrent.progress)}</strong>
          </div>
          <progress
            max={1}
            value={torrent.progress}
            aria-label={`Download ${String(number)} ${fresh ? "progress" : "last recorded progress"}`}
          />
        </div>
      )}
      <p className={fresh ? "helper" : "progress-protection"}>
        {observationMessage(torrent)}
        {torrent.observedAt === null
          ? ""
          : ` · ${dateLabel(torrent.observedAt)}`}
      </p>
      <dl className="download-facts">
        <div>
          <dt>Share ratio</dt>
          <dd>{ratio}</dd>
        </div>
        <div>
          <dt>Actual seeded time</dt>
          <dd>
            {torrent.seededSeconds === null
              ? "Not observed"
              : seededDuration(torrent.seededSeconds)}
          </dd>
        </div>
      </dl>
      {torrent.progress === 1 && torrent.state !== "removed" && (
        <p className="helper">
          Download completion and seeding are separate from verified playback.
        </p>
      )}
      {torrent.diagnostics !== null && (
        <SeedingDiagnostics
          diagnostics={torrent.diagnostics}
          currentObservation={fresh}
        />
      )}
    </article>
  );
}
