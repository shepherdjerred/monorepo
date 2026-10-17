import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { ownerHealthDescriptions } from "#shared/notification-authority.ts";
import {
  CommandResultSchema,
  NotificationListSchema,
  OperationListSchema,
  ProfileListSchema,
  RemovalListSchema,
  RequestListSchema,
  UserListSchema,
} from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
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
import {
  ProviderAdministration,
  ManualSubtitleAdministration,
} from "./admin.tsx";
import { NotificationCallback, NotificationSettings } from "./preferences.tsx";
import { DeliveryActions } from "./notification-actions.tsx";
import { ProfileEditor } from "./profile-controls.tsx";
import { PlexProfileAdministration } from "./plex-admin.tsx";
import { NumberingAdministration } from "./numbering-admin.tsx";

export function RequestsPage({ user }: { user: MediaUser }) {
  const requests = useQuery({
    queryKey: ["requests"],
    queryFn: async () => readApi("/requests", RequestListSchema),
    refetchInterval: 15_000,
  });
  const cancel = useMutation({
    mutationFn: async (input: { id: string; version: number }) =>
      writeApi({
        actorId: user.id,
        path: `/requests/${encodeURIComponent(input.id)}/cancel`,
        body: { expectedVersion: input.version },
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
  return (
    <>
      <PageTitle eyebrow="Your watchlist, in motion" title="My requests">
        <p>
          Everything you’ve asked for, from the first search to movie night.
        </p>
      </PageTitle>
      {requests.isPending && <Loading />}
      {requests.error !== null && <ErrorNotice error={requests.error} />}
      {cancel.error !== null && <ErrorNotice error={cancel.error} />}
      {requests.data?.length === 0 && (
        <EmptyState title="Your next favorite is waiting">
          Search Discover to add your first film or series.{" "}
          <Link to="/">Find something to watch →</Link>
        </EmptyState>
      )}
      <div className="item-list">
        {requests.data?.map((request) => (
          <article className="request-row" key={request.id}>
            <div className="item-symbol" aria-hidden="true">
              {request.media.kind === "movie" ? "◈" : "▤"}
            </div>
            <div className="item-main">
              <MediaLink id={request.mediaId} title={request.media.title} />
              <p>
                {humanize(request.media.kind)}
                {request.media.year === null
                  ? ""
                  : ` · ${String(request.media.year)}`}
                {request.subtitleLanguages.length > 0
                  ? ` · ${request.subtitleLanguages.join(", ")} subtitles`
                  : ""}
              </p>
              {request.media.catalogState === "pending" && (
                <p className="helper">
                  Episode details are loading; request coverage will update as
                  they arrive.
                </p>
              )}
            </div>
            <Status
              value={request.active ? request.media.availability : "cancelled"}
            />
            {request.active && (
              <button
                className="button subtle"
                disabled={cancel.isPending}
                onClick={() => {
                  cancel.mutate({ id: request.id, version: request.version });
                }}
              >
                Cancel request
              </button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

export function ActivityPage() {
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: async () => readApi("/activity", OperationListSchema),
    refetchInterval: 10_000,
  });
  return (
    <>
      <PageTitle eyebrow="Behind the scenes" title="Activity">
        <p>A clear view of what’s happening in your library.</p>
      </PageTitle>
      {activity.isPending && <Loading />}
      {activity.error !== null && <ErrorNotice error={activity.error} />}
      {activity.data?.length === 0 && (
        <EmptyState title="All quiet here">
          New requests, upgrades, and library changes will appear here.
        </EmptyState>
      )}
      <div className="timeline">
        {activity.data?.map((operation) => (
          <article className="timeline-item" key={operation.id}>
            <span className="timeline-dot" aria-hidden="true" />
            <div className="item-main">
              <h2>{humanize(operation.kind)}</h2>
              <p>{dateLabel(operation.updatedAt)}</p>
              {operation.mediaId !== null && (
                <Link
                  className="text-link"
                  to={`/media/${encodeURIComponent(operation.mediaId)}`}
                >
                  View title →
                </Link>
              )}
            </div>
            <Status value={operation.status} />
          </article>
        ))}
      </div>
    </>
  );
}

export function RemovalsPage({ user }: { user: MediaUser }) {
  const removals = useQuery({
    queryKey: ["removals"],
    queryFn: async () => readApi("/removals", RemovalListSchema),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageTitle eyebrow="Room for something new" title="Leaving soon">
        <p>
          Watched by everyone who requested it? We’ll give you a heads-up before
          making room.
        </p>
      </PageTitle>
      <Notice>
        Keep adds 30 days of protection. Removed titles stay recoverable for
        seven days.
      </Notice>
      {removals.isPending && <Loading />}
      {removals.error !== null && <ErrorNotice error={removals.error} />}
      {removals.data?.length === 0 && (
        <EmptyState title="Nothing is leaving soon">
          Any scheduled removals will appear here with time to keep what you
          love.
        </EmptyState>
      )}
      <div className="item-list">
        {removals.data?.map((removal) => (
          <article className="request-row" key={removal.id}>
            <div className="item-symbol" aria-hidden="true">
              ◷
            </div>
            <div className="item-main">
              <MediaLink id={removal.mediaId} title={removal.media.title} />
              <p>
                {removal.state === "quarantined"
                  ? "Recoverable until"
                  : "Removal scheduled"}
                :{" "}
                {dateLabel(
                  removal.state === "quarantined"
                    ? removal.purgeAfter
                    : removal.graceUntil,
                )}
              </p>
            </div>
            <Status value={removal.state} />
            <MediaActionButton
              user={user}
              mediaId={removal.mediaId}
              version={removal.media.version}
              action={removal.state === "quarantined" ? "restore" : "keep"}
            />
          </article>
        ))}
      </div>
    </>
  );
}

export function NotificationsPage({ user }: { user: MediaUser }) {
  const location = useLocation();
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => readApi("/notifications", NotificationListSchema),
    refetchInterval: 30_000,
  });
  if (new URLSearchParams(location.hash.slice(1)).has("verify"))
    return <NotificationCallback user={user} channel="email" />;
  return (
    <>
      <PageTitle eyebrow="Stay in the loop" title="Notifications">
        <p>
          New arrivals, subtitle updates, and a little notice before anything
          leaves.
        </p>
      </PageTitle>
      <NotificationSettings user={user} />
      {notifications.isPending && <Loading />}
      {notifications.error !== null && (
        <ErrorNotice error={notifications.error} />
      )}
      {notifications.data?.length === 0 && (
        <EmptyState title="You’re all caught up">
          Updates for your requests will appear here.
        </EmptyState>
      )}
      <div className="item-list">
        {notifications.data?.map((notification) => (
          <article className="request-row" key={notification.id}>
            <div className="item-symbol" aria-hidden="true">
              ◉
            </div>
            <div className="item-main">
              <h2>{humanize(notification.event.kind)}</h2>
              {notification.event.healthReason !== undefined && (
                <p>
                  {ownerHealthDescriptions[notification.event.healthReason]}
                </p>
              )}
              {notification.event.healthState === "superseded" && (
                <p>
                  This alert describes an earlier authority state. Its delivery
                  history is preserved; it cannot be sent again.
                </p>
              )}
              {notification.event.kind === "owner_health" &&
                user.role === "owner" && (
                  <Link className="text-link" to="/recovery">
                    Review recovery protections →
                  </Link>
                )}
              <p>
                {humanize(notification.channel)} ·{" "}
                {dateLabel(notification.createdAt)}
              </p>
              {notification.event.mediaId !== null && (
                <Link
                  className="text-link"
                  to={`/media/${encodeURIComponent(notification.event.mediaId)}`}
                >
                  View title →
                </Link>
              )}
              <DeliveryActions user={user} delivery={notification} />
            </div>
            <Status
              value={
                notification.event.healthState === "superseded"
                  ? "superseded"
                  : (notification.providerStatus ?? notification.state)
              }
            />
          </article>
        ))}
      </div>
    </>
  );
}

export function AdminPage({ user }: { user: MediaUser }) {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => readApi("/admin/users", UserListSchema),
  });
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  const restrict = useMutation({
    mutationFn: async (input: {
      id: string;
      version: number;
      restricted: boolean;
    }) =>
      writeApi({
        actorId: user.id,
        path: `/admin/users/${encodeURIComponent(input.id)}`,
        body: { expectedVersion: input.version, restricted: input.restricted },
        schema: CommandResultSchema,
        method: "PATCH",
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
  return (
    <>
      <PageTitle eyebrow="Library owner" title="Administration">
        <p>
          Manage your household’s access and review the library’s quality
          profiles.
        </p>
      </PageTitle>
      {users.error !== null && <ErrorNotice error={users.error} />}
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
      {restrict.error !== null && <ErrorNotice error={restrict.error} />}
      <section className="panel">
        <h2>Household access</h2>
        {users.isPending && <Loading />}
        {users.data?.map((person) => (
          <div className="list-row" key={person.id}>
            <div>
              <strong>{person.displayName}</strong>
              <p className="muted">{humanize(person.role)}</p>
            </div>
            <Status
              value={person.restricted ? "requests_paused" : "requests_enabled"}
            />
            {person.role !== "owner" && (
              <button
                className="button subtle"
                disabled={restrict.isPending}
                onClick={() => {
                  restrict.mutate({
                    id: person.id,
                    version: person.version,
                    restricted: !person.restricted,
                  });
                }}
              >
                {person.restricted ? "Enable requests" : "Pause requests"}
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Quality profiles</h2>
        {profiles.isPending && <Loading />}
        {profiles.data?.length === 0 && (
          <p className="muted">No quality profiles have been configured yet.</p>
        )}
        {profiles.data?.map((profile) => (
          <details className="profile-details" key={profile.id}>
            <summary>
              {profile.name}
              <span>Version {profile.version}</span>
            </summary>
            <ProfileEditor user={user} profile={profile} />
          </details>
        ))}
      </section>
      <section className="panel">
        <h2>Create a quality profile</h2>
        <ProfileEditor user={user} profile={null} />
      </section>
      <ManualSubtitleAdministration user={user} />
      <PlexProfileAdministration user={user} />
      <NumberingAdministration user={user} />
      <ProviderAdministration user={user} />
    </>
  );
}
