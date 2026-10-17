import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { MediaDetailSchema, ProfileListSchema } from "#shared/api.ts";
import type { MediaDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { readApi } from "./api.ts";
import {
  dateLabel,
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
  MediaLink,
  Notice,
  PageTitle,
  Status,
} from "./components.tsx";
import { MediaActionButton } from "./media-actions.tsx";
import { ReleaseCandidates } from "./releases.tsx";
import { AssignProfile } from "./profile-controls.tsx";
import { RequestTitle } from "./request-controls.tsx";
import { MediaProgress } from "./media-progress/panel.tsx";
import { useTarget } from "./target-controls/api.ts";
import {
  ProtectionControls,
  ProtectionNotice,
} from "./target-controls/protection.tsx";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { RemovalReview } from "./target-controls/removal.tsx";

export function MediaPage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  const target = useTarget(id);
  const item = useQuery({
    queryKey: ["media", id],
    enabled: id !== undefined,
    queryFn: async () =>
      readApi(`/media/${encodeURIComponent(String(id))}`, MediaDetailSchema),
    refetchInterval: 15_000,
  });
  if (id === undefined)
    return (
      <EmptyState title="Title unavailable">
        Return to your requests to select a title.
      </EmptyState>
    );
  if (target.isPending) return <Loading />;
  if (target.error !== null) return <ErrorNotice error={target.error} />;
  const context = target.data;
  if (context.access === "protection_only")
    return (
      <>
        <Link className="back-link" to="/requests">
          ← My requests
        </Link>
        <PageTitle eyebrow="Your request" title="Request protections" />
        <ProtectionNotice />
        <ProtectionControls user={user} context={context} />
      </>
    );
  if (item.isPending) return <Loading />;
  if (item.error !== null) return <ErrorNotice error={item.error} />;
  return (
    <MediaDetails
      user={user}
      media={item.data}
      context={context}
      refresh={() => {
        void Promise.all([item.refetch(), target.refetch()]);
      }}
    />
  );
}

function MediaDetails({
  user,
  media,
  context,
  refresh,
}: {
  user: MediaUser;
  media: MediaDetail;
  context: Extract<DefaultTargetView, { access: "detail" }>;
  refresh: () => void;
}) {
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  const paired = media.version === context.expected.mediaVersion;
  const profile = profiles.data?.find(
    (candidate) => candidate.id === media.intent?.profileId,
  );
  const claimed = media.requests.some((request) => request.userId === user.id);
  return (
    <>
      <Link className="back-link" to="/requests">
        ← My requests
      </Link>
      <PageTitle
        eyebrow={`${humanize(media.kind)}${media.year === null ? "" : ` · ${String(media.year)}`}`}
        title={media.title}
      >
        <Status value={media.availability} />
      </PageTitle>
      {media.catalogState === "pending" && (
        <Notice>
          Episode details are still loading. You can request this series now;
          matching episodes will be included as the catalog finishes updating.
        </Notice>
      )}
      <MediaProgress visibility={media.visibility} />
      {!paired && (
        <Notice>
          <p>
            This title changed while its details were loading. Refresh before
            choosing an action.
          </p>
          <button className="button" type="button" onClick={refresh}>
            Refresh title
          </button>
        </Notice>
      )}
      <div className="detail-columns" inert={!paired}>
        <section className="panel">
          <h2>In your library</h2>
          <dl className="facts">
            <div>
              <dt>Availability</dt>
              <dd>{humanize(media.availability)}</dd>
            </div>
            <div>
              <dt>Upgrade monitoring</dt>
              <dd>{media.intent?.monitoring === true ? "Active" : "Paused"}</dd>
            </div>
            <div>
              <dt>Quality profile</dt>
              <dd>{profile?.name ?? "Not assigned"}</dd>
            </div>
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
          <MediaControls
            key={media.id}
            media={media}
            user={user}
            claimed={claimed}
            context={context}
          />
          {!claimed && (
            <RequestTitle
              key={media.id}
              user={user}
              context={context}
              kind={media.kind}
            />
          )}
          {user.role === "owner" && (
            <AssignProfile
              key={media.version}
              user={user}
              mediaId={media.id}
              version={media.version}
              currentId={media.intent?.profileId ?? null}
            />
          )}
        </section>
        <section className="panel">
          <h2>Files & subtitles</h2>
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
                  <Status value={asset.state} />
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
                        {target.language} ·{" "}
                        {target.forced
                          ? "Forced dialogue"
                          : "Regular subtitles"}{" "}
                        ·{" "}
                        {target.hearingImpaired === "any"
                          ? "HI captions optional"
                          : target.hearingImpaired === "required"
                            ? "HI captions required"
                            : "Without HI captions"}
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
                        <Status value={subtitle.state} />
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
      </div>
      {media.children.length > 0 && (
        <section className="panel">
          <h2>
            {media.kind === "series" ? "Choose a season" : "Choose an episode"}
          </h2>
          <p className="muted">Open an item to request it individually.</p>
          {media.children.map((child) => (
            <div className="list-row" key={child.id}>
              <MediaLink id={child.id} title={child.title} />
              {child.catalogState === "pending" && (
                <span className="helper">Episode details pending</span>
              )}
              <Status value={child.availability} />
            </div>
          ))}
        </section>
      )}
      <History media={media} />
      <div inert={!paired}>
        <ReleaseCandidates
          key={media.id}
          user={user}
          mediaId={media.id}
          context={context}
        />
      </div>
    </>
  );
}

function MediaControls({
  media,
  user,
  claimed,
  context,
}: {
  media: MediaDetail;
  user: MediaUser;
  claimed: boolean;
  context: DefaultTargetView;
}) {
  const pinned = media.holds.some(
    (hold) => hold.isPin && hold.userId === user.id,
  );
  return (
    <>
      <div className="button-row">
        {claimed && (
          <MediaActionButton user={user} context={context} action="keep" />
        )}
        {user.role === "owner" && (
          <MediaActionButton
            user={user}
            context={context}
            action={pinned ? "unpin" : "pin"}
          />
        )}
        {(claimed || user.role === "owner") &&
          media.availability === "quarantined" && (
            <MediaActionButton user={user} context={context} action="restore" />
          )}
        {user.role === "owner" && media.availability !== "available" && (
          <MediaActionButton user={user} context={context} action="retry" />
        )}
      </div>
      {media.holds.map((hold) => (
        <p className="helper" key={hold.id}>
          {hold.isPin
            ? "Pinned indefinitely"
            : `Protected until ${dateLabel(hold.until)}`}
        </p>
      ))}
      {media.retention.map((decision) => (
        <div className="retention-summary" key={decision.id}>
          <Status value={decision.state} />
          <p>
            {decision.state === "quarantined"
              ? `Recoverable until ${dateLabel(decision.purgeAfter)}`
              : `Removal: ${dateLabel(decision.graceUntil)}`}
          </p>
        </div>
      ))}
      {user.role === "owner" && media.availability === "available" && (
        <RemovalReview user={user} media={media} context={context} />
      )}
    </>
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
