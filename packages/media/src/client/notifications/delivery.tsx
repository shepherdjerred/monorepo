import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CommandResultSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { humanize } from "#client/components.tsx";
import {
  CHANNEL_COPY,
  DELIVERY_OUTCOME_COPY,
  type DeliveryOutcome,
} from "#client/presentation/notification.ts";
import { classNames } from "#client/ui/class-names.ts";
import {
  deliveryChannel,
  deliveryOutcome,
  deliveryState,
  type Delivery,
} from "./model.ts";
import styles from "./notifications.module.css";
import { NOTIFICATIONS_KEY } from "./use-notifications.ts";

const cx = classNames(styles);

type DeliveryCommand =
  { kind: "read" } | { kind: "retry" } | { kind: "reconcile"; receipt: string };

/**
 * A command on one delivery: mark its reminder read, send it again, or ask
 * its provider what became of it. Each names the version it was read at, so
 * a delivery that changed meanwhile is refused instead of overwritten.
 */
export function useDeliveryCommand(user: MediaUser, delivery: Delivery) {
  return useMutation({
    mutationFn: async (command: DeliveryCommand) =>
      writeApi({
        actorId: user.id,
        path: `/notifications/${encodeURIComponent(delivery.id)}/${command.kind}`,
        body: {
          expectedVersion: delivery.version,
          ...(command.kind === "reconcile" && command.receipt !== ""
            ? { receipt: command.receipt }
            : {}),
        },
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

/** The reasons a failed delivery may be sent again without a provider's proof. */
const RETRYABLE_REASONS = new Set([
  "provider_rejected",
  "authority_changed_before_send",
]);
/** Media gives up on a delivery after this many attempts. */
const ATTEMPT_LIMIT = 3;

function canSendAgain(delivery: Delivery, outcome: DeliveryOutcome): boolean {
  return (
    delivery.attempts < ATTEMPT_LIMIT &&
    (outcome === "bounced" ||
      (outcome === "failed" &&
        RETRYABLE_REASONS.has(delivery.failureReason ?? "")))
  );
}

/** What a delivery that did not simply arrive means for its reader. */
const OUTCOME_NOTES = {
  unread: null,
  read: null,
  waiting: null,
  sent: null,
  delivered: null,
  bounced:
    "The mail service reported that this bounced. Check your email address in Notification settings; after that it can be sent again. A leaving-soon warning restarts its seven days once the new message is accepted.",
  failed: "This message could not be sent.",
  sending:
    "Media does not know yet whether this arrived. It is not sent again without proof that it was refused.",
  unconfirmed:
    "Media does not know whether this arrived. It is not sent again without proof that it was refused.",
} as const satisfies Record<DeliveryOutcome, string | null>;

/**
 * One channel of a notification: how its delivery ended up, what that means,
 * and what can be done about it. `settled` is an alert whose delivery record
 * is kept as history and takes no further commands.
 */
export function DeliveryDetail({
  user,
  delivery,
  settled,
}: {
  user: MediaUser;
  delivery: Delivery;
  settled: boolean;
}) {
  const receiptId = useId();
  const [receipt, setReceipt] = useState("");
  const command = useDeliveryCommand(user, delivery);
  const channel = deliveryChannel(delivery.channel);
  const state = deliveryState(delivery.state);
  const outcome = deliveryOutcome(delivery);
  const note = OUTCOME_NOTES[outcome];
  const uncertain = outcome === "sending" || outcome === "unconfirmed";
  // A provider can still be asked about a message it took or may have taken.
  const canCheck =
    channel !== "in_app" && state !== "pending" && state !== "failed";
  return (
    <li className={cx("delivery")}>
      <p className={cx("deliveryHead")}>
        {CHANNEL_COPY[channel]}: {DELIVERY_OUTCOME_COPY[outcome].label}
      </p>
      {note !== null && (
        <p
          className={cx("deliveryNote")}
          role={outcome === "bounced" ? "alert" : undefined}
        >
          {note}
        </p>
      )}
      {user.role === "owner" && delivery.failureReason !== null && (
        <p className={cx("deliveryNote")}>
          Recorded reason: {humanize(delivery.failureReason).toLowerCase()}.
        </p>
      )}
      {!settled && (
        <div className={cx("deliveryActions")}>
          {canSendAgain(delivery, outcome) && (
            <button
              className="button subtle"
              type="button"
              disabled={command.isPending}
              onClick={() => {
                command.mutate({ kind: "retry" });
              }}
            >
              Send again
            </button>
          )}
          {uncertain && user.role === "owner" && (
            <label className={cx("receipt")} htmlFor={receiptId}>
              Provider receipt
              <input
                id={receiptId}
                value={receipt}
                placeholder="Mail message ID or Discord receipt"
                onChange={(event) => {
                  setReceipt(event.target.value);
                }}
              />
            </label>
          )}
          {canCheck && (
            <button
              className="button subtle"
              type="button"
              disabled={command.isPending}
              onClick={() => {
                command.mutate({ kind: "reconcile", receipt });
              }}
            >
              Check delivery
            </button>
          )}
        </div>
      )}
      {command.isSuccess && (
        <p className={cx("deliveryNote")} role="status">
          {command.variables.kind === "retry"
            ? "Sending again."
            : "Checking delivery."}
        </p>
      )}
      {command.error !== null && (
        <p className={cx("deliveryError")} role="alert">
          {command.error.message}
        </p>
      )}
    </li>
  );
}
