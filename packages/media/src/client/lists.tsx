import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { ownerHealthDescriptions } from "#shared/notification-authority.ts";
import {
  NotificationListSchema,
  RemovalListSchema,
  RequestListSchema,
} from "#shared/api.ts";
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
  WireStatus,
} from "./components.tsx";
import {
  ListedMediaAction,
  RequestProtection,
} from "./target-controls/protection.tsx";
import { NotificationCallback, NotificationSettings } from "./preferences.tsx";
import { DeliveryActions } from "./notification-actions.tsx";
import { MovieRequests } from "./movie-editions/requests.tsx";
import { RequestInterests } from "./household/interests.tsx";
import { useImportedRequests } from "./personal-migration/source.tsx";

export function RequestsPage({ user }: { user: MediaUser }) {
  const imported = useImportedRequests(user.id);
  const requests = useQuery({
    queryKey: ["requests"],
    queryFn: async () => readApi("/requests", RequestListSchema),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageTitle title="My requests">
        <p>
          Everything you’ve asked for, from the first search to movie night.
        </p>
      </PageTitle>
      {requests.isPending && <Loading />}
      {requests.error !== null && <ErrorNotice error={requests.error} />}
      {imported.error !== null && <ErrorNotice error={imported.error} />}
      <RequestInterests user={user} importedClaims={imported.data ?? []} />
      <MovieRequests user={user} />
      <div className="item-list">
        {requests.data
          ?.filter((request) => request.media.kind !== "movie")
          .map((request) => (
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
                value={
                  request.active ? request.media.availability : "cancelled"
                }
              />
              <RequestProtection user={user} request={request} />
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
      <PageTitle title="Leaving soon">
        <p>
          Titles leave when no one is following and no permanent Keep remains.
          You’ll have time to change your mind before Media removes the files.
        </p>
      </PageTitle>
      <Notice>
        Use My requests to keep watching, or Library to change permanent
        keeping. Titles have seven days in Leaving Soon and another seven days
        in recoverable quarantine. A 30-day protection hold remains available
        here.
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
            <WireStatus value={removal.state} />
            <ListedMediaAction
              user={user}
              mediaId={removal.mediaId}
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
      <PageTitle title="Notifications">
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
            <WireStatus
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
