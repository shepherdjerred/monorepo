import { BellIcon, SettingsIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { NotificationCallback } from "./callback.tsx";
import { groupNotifications, isCutOff } from "./model.ts";
import styles from "./notifications.module.css";
import { NOTIFICATION_SETTINGS_PATH } from "./paths.ts";
import { NotificationRow } from "./row.tsx";
import { useNotifications } from "./use-notifications.ts";

const cx = classNames(styles);

/**
 * What Media has told the reader, newest first: one entry per event, with
 * the channels it went out on as badges. How to be told is on its own page,
 * Notification settings.
 */
export function NotificationsPage({ user }: { user: MediaUser }) {
  const location = useLocation();
  const notifications = useNotifications();
  // An older verification email links here with its token in the fragment.
  if (new URLSearchParams(location.hash.slice(1)).has("verify")) {
    return <NotificationCallback user={user} channel="email" />;
  }

  function content() {
    if (notifications.error !== null) {
      return (
        <ErrorState
          error={notifications.error}
          what="Your notifications"
          onRetry={() => {
            void notifications.refetch();
          }}
        />
      );
    }
    if (notifications.isPending) {
      return <RowsSkeleton label="Loading notifications" />;
    }
    const rows = notifications.data;
    if (rows.length === 0) {
      return (
        <EmptyState
          icon={BellIcon}
          title="Nothing to tell you yet"
          action={
            <Link className="button" to={NOTIFICATION_SETTINGS_PATH}>
              Choose how Media reaches you
            </Link>
          }
        >
          News about what you asked for appears here: when it is ready, when a
          better version arrives, and before anything leaves.
        </EmptyState>
      );
    }
    return (
      <>
        <ul className={cx("rows")} aria-label="Notifications">
          {groupNotifications(rows).map((notification) => (
            <NotificationRow
              key={notification.id}
              user={user}
              notification={notification}
            />
          ))}
        </ul>
        {isCutOff(rows) && (
          <p className={cx("cutOff")}>Earlier notifications are not listed.</p>
        )}
      </>
    );
  }

  return (
    <>
      <div className={cx("header")}>
        <PageTitle title="Notifications">
          <p>
            When something you asked for is ready, when a better version
            arrives, and before anything leaves.
          </p>
        </PageTitle>
        <Link className={cx("settingsLink")} to={NOTIFICATION_SETTINGS_PATH}>
          <SettingsIcon aria-hidden="true" />
          Notification settings
        </Link>
      </div>
      {content()}
    </>
  );
}
