import { useQuery } from "@tanstack/react-query";
import { ProfileListSchema } from "#shared/api.ts";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { readApi } from "#client/api.ts";
import {
  dateLabel,
  ErrorNotice,
  humanize,
  WireStatus,
} from "#client/components.tsx";
import { MediaActionButton } from "#client/media-actions.tsx";
import { MediaProgress } from "#client/media-progress/panel.tsx";
import { MovieEditionControlsV4 } from "#client/movie-editions/target-controls-v4.tsx";
import { AssignProfile } from "#client/profile-controls.tsx";
import { ReleaseCandidates } from "#client/releases.tsx";
import { RemovalReview } from "#client/target-controls/removal.tsx";

/*
 * The owner's tools for one title: how it is being acquired and seeded, its
 * quality profile, its files as the system records them, the releases it was
 * matched against, and its event history. These are the operator panels the
 * title page has always had, unchanged; they are fetched only when the owner
 * opens the Manage view, so none of this code reaches a household member.
 */

function TitleFacts({ user, media }: { user: MediaUser; media: MediaDetail }) {
  // The server tells only an unrestricted owner which profile is assigned.
  // Anyone else would read a withheld profile as "Not assigned".
  const operator = !user.restricted;
  const profiles = useQuery({
    queryKey: ["profiles"],
    enabled: operator,
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  const profile = profiles.data?.find(
    (candidate) => candidate.id === media.intent?.profileId,
  );
  return (
    <>
      <dl className="facts">
        <div>
          <dt>Availability</dt>
          <dd>{humanize(media.availability)}</dd>
        </div>
        <div>
          <dt>Upgrade monitoring</dt>
          <dd>{media.intent?.monitoring === true ? "Active" : "Paused"}</dd>
        </div>
        {operator && (
          <div>
            <dt>Quality profile</dt>
            <dd>{profile?.name ?? "Not assigned"}</dd>
          </div>
        )}
        <div>
          <dt>Requested by</dt>
          <dd>
            {media.requests
              .map((request) => request.user.displayName)
              .join(", ") || "No active requesters"}
          </dd>
        </div>
      </dl>
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
    </>
  );
}

/** Retrying an acquisition, the protections in force, and removal. */
function LifecycleControls({
  user,
  media,
  context,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: DefaultTargetView;
}) {
  return (
    <>
      {media.availability !== "available" && (
        <div className="button-row">
          <MediaActionButton user={user} context={context} action="retry" />
        </div>
      )}
      {media.holds.map((hold) => (
        <p className="helper" key={hold.id}>
          {hold.isPin
            ? "Pinned indefinitely"
            : `Protected until ${dateLabel(hold.until)}`}
        </p>
      ))}
      {media.retention.map((decision) => (
        <div className="retention-summary" key={decision.id}>
          <WireStatus value={decision.state} />
          <p>
            {decision.state === "quarantined"
              ? `Recoverable until ${dateLabel(decision.purgeAfter)}`
              : `Removal: ${dateLabel(decision.graceUntil)}`}
          </p>
        </div>
      ))}
      {media.availability === "available" && (
        <RemovalReview user={user} media={media} context={context} />
      )}
    </>
  );
}

function subtitleTarget(target: {
  language: string;
  forced: boolean;
  hearingImpaired: "any" | "required" | "excluded";
}): string {
  const captions =
    target.hearingImpaired === "any"
      ? "HI captions optional"
      : target.hearingImpaired === "required"
        ? "HI captions required"
        : "Without HI captions";
  return `${target.language} · ${target.forced ? "Forced dialogue" : "Regular subtitles"} · ${captions}`;
}

function RecordedFiles({ media }: { media: MediaDetail }) {
  return (
    <section className="panel">
      <h2>
        {media.kind === "movie"
          ? "Unmarked edition files & subtitles"
          : "Files & subtitles"}
      </h2>
      {media.assets.length === 0 ? (
        <p className="muted">
          No files have been published yet. Download and import progress is
          shown above.
        </p>
      ) : (
        media.assets.map(({ asset, current, edition }) => (
          <div className="asset-card" key={asset.id}>
            <div className="section-heading">
              <h3>{current ? "Current version" : "Previous version"}</h3>
              <WireStatus value={asset.state} />
            </div>
            <p className="muted">
              {humanize(edition)} · Added {dateLabel(asset.createdAt)}
            </p>
            {asset.subtitleStatus !== null && (
              <div className="retention-summary">
                <strong>
                  {asset.subtitleStatus.satisfied
                    ? "Subtitle requirements met"
                    : "Subtitle requirements pending"}
                </strong>
                {asset.subtitleStatus.missing.map((target) => (
                  <p className="helper" key={target.sourceItemId}>
                    {subtitleTarget(target)}
                  </p>
                ))}
                {asset.subtitleStatus.householdMissing.map((target) => (
                  <p className="helper" key={`household-${target.language}`}>
                    English regular subtitles required for original-language
                    playback
                  </p>
                ))}
                {asset.subtitleStatus.protectedReasons.map((reason) => (
                  <p className="helper" key={reason}>
                    {humanize(reason)}
                  </p>
                ))}
              </div>
            )}
            {asset.subtitles.length === 0 ? (
              <p className="helper">No matched subtitles yet.</p>
            ) : (
              <ul className="subtitle-list">
                {asset.subtitles.map((subtitle) => (
                  <li key={subtitle.id}>
                    <span>
                      {subtitle.language} · {subtitle.providerId}
                      {subtitle.forced === true ? " · Forced" : ""}
                      <br />
                      <small className="helper">
                        {subtitle.accepted
                          ? "Quality verified for this video"
                          : "Quality unverified for this video"}
                      </small>
                    </span>
                    <WireStatus value={subtitle.state} />
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary>Media properties</summary>
              <pre>{JSON.stringify(asset.properties, null, 2)}</pre>
            </details>
          </div>
        ))
      )}
    </section>
  );
}

function History({ media }: { media: MediaDetail }) {
  return (
    <section className="panel">
      <h2>Title history</h2>
      {media.events.length === 0 ? (
        <p className="muted">Changes to this title will appear here.</p>
      ) : (
        <div className="timeline">
          {media.events.map((event) => (
            <div className="timeline-item" key={event.id}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <strong>{humanize(event.kind)}</strong>
                <p className="muted">{dateLabel(event.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The Manage view of a title page. `paired` is false while the title's
 * details and its command versions disagree; controls that would send a
 * command are inert until the page has read both again.
 */
export function ManageTitle({
  user,
  media,
  context,
  paired,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: DefaultTargetView;
  paired: boolean;
}) {
  const movie = media.kind === "movie";
  return (
    <>
      <MediaProgress
        visibility={media.visibility}
        heading={
          movie ? "Unmarked edition download & seeding" : "Download & seeding"
        }
      />
      {movie && (
        <MovieEditionControlsV4 key={media.id} user={user} mediaId={media.id} />
      )}
      <div className="detail-columns" inert={!paired}>
        <section className="panel">
          <h2>
            {movie ? "Unmarked edition in your library" : "In your library"}
          </h2>
          <TitleFacts user={user} media={media} />
          {!movie && (
            <LifecycleControls
              key={`controls:${media.id}`}
              user={user}
              media={media}
              context={context}
            />
          )}
          <AssignProfile
            key={media.version}
            user={user}
            mediaId={media.id}
            version={media.version}
            currentId={media.intent?.profileId ?? null}
          />
        </section>
        <RecordedFiles media={media} />
      </div>
      <History media={media} />
      {!movie && (
        <div inert={!paired}>
          <ReleaseCandidates
            key={media.id}
            user={user}
            mediaId={media.id}
            context={context}
          />
        </div>
      )}
    </>
  );
}
