import {
  BellIcon,
  MailCheckIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  INTEREST_ACTION_NAMES,
  LIBRARY_VIEW_NAMES,
} from "#shared/household/names.ts";
import { ownerHealthDescriptions } from "#shared/notification-authority.ts";
import { dateLabel } from "#client/components.tsx";
import {
  CHANNEL_COPY,
  DELIVERY_OUTCOME_COPY,
  type NotificationKind,
} from "#client/presentation/notification.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { DeliveryDetail, useDeliveryCommand } from "./delivery.tsx";
import {
  deliveryChannel,
  deliveryOutcome,
  needsAttention,
  notificationTitle,
  type Delivery,
  type Notification,
} from "./model.ts";
import styles from "./notifications.module.css";

const cx = classNames(styles);

/** The mark of an event that is about no title, in place of a poster. */
const KIND_ICONS: Partial<Record<NotificationKind, LucideIcon>> = {
  owner_health: ShieldAlertIcon,
  email_verification: MailCheckIcon,
};

/**
 * The reminder a reader has not acknowledged yet, and the button that does.
 * Reading it is what starts the title's seven-day warning, so the button
 * says so before it is pressed.
 */
function MarkRead({ user, delivery }: { user: MediaUser; delivery: Delivery }) {
  const command = useDeliveryCommand(user, delivery);
  return (
    <div className={cx("unreadAction")}>
      <p className={cx("line")}>
        Marking this as read starts its seven-day warning. To keep following it,
        choose {INTEREST_ACTION_NAMES.continue} under{" "}
        <Link className="text-link" to="/library/mine">
          {LIBRARY_VIEW_NAMES.mine}
        </Link>{" "}
        in the Library.
      </p>
      <button
        className="button"
        type="button"
        disabled={command.isPending}
        onClick={() => {
          command.mutate({ kind: "read" });
        }}
      >
        {command.isPending ? "Marking as read…" : "Mark as read"}
      </button>
      {command.error !== null && (
        <p className={cx("deliveryError")} role="alert">
          {command.error.message}
        </p>
      )}
    </div>
  );
}

/** What an event about the owner's own system adds to its sentence. */
function HealthNotes({
  notification,
  owner,
}: {
  notification: Notification;
  owner: boolean;
}) {
  const { healthReason, healthState } = notification.event;
  return (
    <>
      {healthReason !== undefined && (
        <p className={cx("line")}>{ownerHealthDescriptions[healthReason]}</p>
      )}
      {healthState === "superseded" && (
        <p className={cx("line")}>
          This alert describes an earlier state. Its delivery record is kept and
          cannot be sent again.
        </p>
      )}
      {healthState === "invalid" && (
        <p className={cx("line")}>
          This alert could not be read. Its delivery record is kept and cannot
          be changed.
        </p>
      )}
      {owner && (
        <Link className="text-link" to="/recovery">
          Review recovery protections
        </Link>
      )}
    </>
  );
}

/**
 * One notification: what happened, when, and the channels it went out on.
 * It is unread while its reminder in Media waits to be acknowledged.
 *
 * A row that names a title shows its poster and links to its page. A row
 * about no title, or about one the event no longer names, is a plain
 * sentence that links nowhere.
 */
export function NotificationRow({
  user,
  notification,
}: {
  user: MediaUser;
  notification: Notification;
}) {
  const { event, kind, unread, deliveries } = notification;
  const title = notificationTitle(notification);
  const Icon = KIND_ICONS[kind] ?? BellIcon;
  // An alert about an earlier state is history: no command applies to it.
  const settled =
    event.healthState === "superseded" || event.healthState === "invalid";
  return (
    <li className={cx("row")} data-unread={unread !== null}>
      <div className={cx("art")}>
        {event.media === null ? (
          <div className={cx("mark")} aria-hidden="true">
            <Icon />
          </div>
        ) : (
          <Poster
            path={event.media.artwork.posterPath}
            // The art is the film's or the series', so the stand-in for a
            // missing poster carries that name.
            title={event.media.rootTitle}
            sizes="44px"
          />
        )}
      </div>
      <div className={cx("body")}>
        <h2 className={cx("title")}>
          {unread !== null && (
            <>
              <span className={cx("unreadTag")}>Unread</span>{" "}
            </>
          )}
          {event.media === null ? (
            title
          ) : (
            <Link to={`/media/${encodeURIComponent(event.media.id)}`}>
              {title}
            </Link>
          )}
        </h2>
        <p className={cx("when")}>
          <time dateTime={notification.createdAt}>
            {dateLabel(notification.createdAt)}
          </time>
        </p>
        {kind === "owner_health" && (
          <HealthNotes
            notification={notification}
            owner={user.role === "owner"}
          />
        )}
        {kind === "interest_check" && event.interestRequestId !== undefined && (
          <Link
            className="text-link"
            to={`/library/mine?interest=${encodeURIComponent(event.interestRequestId)}`}
          >
            Answer under {LIBRARY_VIEW_NAMES.mine} in the Library
          </Link>
        )}
        {unread !== null && !settled && (
          <MarkRead user={user} delivery={unread} />
        )}
        <ul className={cx("channels")} aria-label="Sent by">
          {deliveries.map((delivery) => {
            const outcome = DELIVERY_OUTCOME_COPY[deliveryOutcome(delivery)];
            return (
              <li
                className={cx("channel")}
                key={delivery.id}
                data-tone={outcome.tone}
              >
                {CHANNEL_COPY[deliveryChannel(delivery.channel)]}:{" "}
                {outcome.label}
              </li>
            );
          })}
        </ul>
        <details
          className={cx("details")}
          open={deliveries.some((delivery) => needsAttention(delivery))}
        >
          <summary>Delivery details</summary>
          <ul className={cx("deliveries")}>
            {deliveries.map((delivery) => (
              <DeliveryDetail
                key={delivery.id}
                user={user}
                delivery={delivery}
                settled={settled}
              />
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
}
