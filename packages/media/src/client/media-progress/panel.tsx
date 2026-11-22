import type { ReactNode } from "react";
import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { dateLabel } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import { FactList } from "#client/ui/record.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
} from "#client/ui/panel.tsx";
import { downloadPercent, seededDuration } from "./format.ts";
import {
  attemptLabel,
  observationMessage,
  playbackHeading,
  playbackMessage,
  torrentHeading,
} from "./presentation.ts";
import { SeedingDiagnostics } from "./seeding.tsx";
import styles from "./progress.module.css";

const cx = classNames(styles);

type Visibility = MediaVisibility;

/**
 * What is happening to a title now: whether it can be watched, the latest
 * acquisition, each download with its seeding, and the acquisition history.
 */
export function MediaProgress({
  visibility,
  heading = "What is happening now",
  description,
  id,
}: {
  visibility: Visibility;
  heading?: string;
  /** What the panel is about, when that is more than the title says. */
  description?: ReactNode;
  id?: string;
}) {
  const latest = visibility.attempts[0];
  const { playback } = visibility;
  return (
    <Panel
      title={heading}
      description={description}
      {...(id === undefined ? {} : { id })}
    >
      <Callout
        tone={playback.playable ? "ok" : "neutral"}
        title={playbackHeading(playback)}
      >
        {playbackMessage(playback)}
      </Callout>
      {(latest !== undefined || playback.upgradeInProgress) && (
        <div className={cx("latest")}>
          {latest !== undefined && (
            <p className={cx("latestRecord")}>
              <span className={cx("muted")}>Latest acquisition record</span>
              <strong>{attemptLabel(latest.state)}</strong>
              {!latest.currentEpoch && <Badge>Recorded before recovery</Badge>}
            </p>
          )}
          {playback.upgradeInProgress && (
            <Badge tone="progress">Upgrade in progress</Badge>
          )}
        </div>
      )}
      <Transfers
        attempts={visibility.attempts}
        torrents={visibility.torrents}
        empty="No download observations are available for your current work on this title."
      />
      {visibility.historyTruncated && (
        <Callout tone="warn">
          Only a bounded selection is shown. Episode totals and acquisition
          history may be partial.
        </Callout>
      )}
    </Panel>
  );
}

/** The downloads of a title and the history of the attempts that made them. */
export function Transfers({
  attempts,
  torrents,
  empty,
}: {
  attempts: Visibility["attempts"];
  torrents: Visibility["torrents"];
  /** What to say when there are no downloads to show. */
  empty: string;
}) {
  return (
    <div className={cx("stack")}>
      {torrents.length === 0 ? (
        <EmptyNote>{empty}</EmptyNote>
      ) : (
        <div className={cx("grid")}>
          {torrents.map((torrent, index) => (
            <TorrentProgress
              key={torrent.id}
              torrent={torrent}
              number={index + 1}
            />
          ))}
        </div>
      )}
      <AcquisitionHistory attempts={attempts} torrents={torrents} />
    </div>
  );
}

/** Each attempt to acquire the title, newest first, with the download it made. */
function AcquisitionHistory({
  attempts,
  torrents,
}: {
  attempts: Visibility["attempts"];
  torrents: Visibility["torrents"];
}) {
  if (attempts.length === 0) return null;
  return (
    <DisclosureList>
      <Disclosure title={`Acquisition history (${String(attempts.length)})`}>
        <ol className={cx("attempts")}>
          {attempts.map((attempt) => {
            const download = torrents.findIndex(
              (torrent) => torrent.id === attempt.torrentId,
            );
            return (
              <li className={cx("attempt")} key={attempt.id}>
                <strong>{attemptLabel(attempt.state)}</strong>
                <span className={cx("muted")}>
                  Started {dateLabel(attempt.createdAt)}.
                  {download === -1
                    ? ""
                    : ` Made download ${String(download + 1)}.`}
                  {attempt.currentEpoch ? "" : " Recorded before recovery."}
                </span>
              </li>
            );
          })}
        </ol>
      </Disclosure>
    </DisclosureList>
  );
}

export function TorrentProgress({
  torrent,
  number,
}: {
  torrent: Visibility["torrents"][number];
  number: number;
}) {
  const fresh = torrent.freshness === "fresh";
  // A member's title page receives neither figure; "Not observed" would then
  // describe a withheld value as a missing one.
  const accounting =
    torrent.diagnostics !== null ||
    torrent.ratio !== null ||
    torrent.seededSeconds !== null;
  const ratio =
    torrent.ratio === null
      ? "Not observed"
      : torrent.ratio.kind === "infinite"
        ? "∞ (infinite)"
        : torrent.ratio.value.toLocaleString(undefined, {
            maximumFractionDigits: 3,
          });
  return (
    <article className={cx("card")} data-stale={!fresh || undefined}>
      <header className={cx("cardHead")}>
        <h3 className={cx("cardTitle")}>{torrentHeading(torrent)}</h3>
        <span className={cx("muted")}>Download {number}</span>
      </header>
      {torrent.progress !== null && (
        <div className={cx("meter")}>
          <div className={cx("meterLine")}>
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
      {fresh ? (
        <p className={cx("muted")}>
          {observationMessage(torrent)}
          {torrent.observedAt === null
            ? ""
            : `, ${dateLabel(torrent.observedAt)}`}
        </p>
      ) : (
        <Callout tone="warn">
          {observationMessage(torrent)}
          {torrent.observedAt === null
            ? ""
            : ` Last observed ${dateLabel(torrent.observedAt)}.`}
        </Callout>
      )}
      {accounting && (
        <FactList
          facts={[
            { term: "Share ratio", detail: ratio },
            {
              term: "Actual seeded time",
              detail:
                torrent.seededSeconds === null
                  ? "Not observed"
                  : seededDuration(torrent.seededSeconds),
            },
          ]}
        />
      )}
      {torrent.progress === 1 && torrent.state !== "removed" && (
        <p className={cx("muted")}>
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
