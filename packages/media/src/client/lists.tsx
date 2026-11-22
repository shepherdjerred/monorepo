import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { ownerHealthDescriptions } from "#shared/notification-authority.ts";
import { NotificationListSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { readApi } from "./api.ts";
import {
  dateLabel,
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
  PageTitle,
  WireStatus,
} from "./components.tsx";
import { NotificationCallback, NotificationSettings } from "./preferences.tsx";
import { DeliveryActions } from "./notification-actions.tsx";

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
