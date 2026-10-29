import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CommandResultSchema, type NotificationList } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { writeApi, queryClient } from "./api.ts";
import { ErrorNotice } from "./components.tsx";

export function DeliveryActions({
  user,
  delivery,
}: {
  user: MediaUser;
  delivery: NotificationList[number];
}) {
  const [receipt, setReceipt] = useState("");
  const action = useMutation({
    mutationFn: async (kind: "retry" | "reconcile") =>
      writeApi({
        actorId: user.id,
        path: `/notifications/${encodeURIComponent(delivery.id)}/${kind}`,
        body: {
          expectedVersion: delivery.version,
          ...(kind === "reconcile" && receipt !== "" ? { receipt } : {}),
        },
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  if (
    delivery.event.healthState === "superseded" ||
    delivery.event.healthState === "invalid"
  )
    return (
      <p className="muted">
        This historical alert is protected from delivery and receipt changes.
      </p>
    );
  return (
    <div className="stack-form">
      {delivery.failureReason !== null && (
        <p className="muted">{delivery.failureReason.replaceAll("_", " ")}</p>
      )}
      {delivery.providerStatus === "bounced" && (
        <p role="alert">
          The mail provider reported a bounce. Check your email address; this
          can be retried explicitly after correction. Removal warnings restart
          their seven-day grace after the new delivery is accepted.
        </p>
      )}
      {(delivery.state === "failed" || delivery.providerStatus === "bounced") &&
        delivery.attempts < 3 &&
        (delivery.providerStatus === "bounced" ||
          ["provider_rejected", "authority_changed_before_send"].includes(
            delivery.failureReason ?? "",
          )) && (
          <button
            className="button"
            disabled={action.isPending}
            onClick={() => {
              action.mutate("retry");
            }}
          >
            {delivery.providerStatus === "bounced"
              ? "Retry bounced delivery"
              : "Retry rejected delivery"}
          </button>
        )}
      {["unknown", "sending"].includes(delivery.state) && (
        <>
          <p>
            Delivery is uncertain. It will not be sent again without proof of
            rejection.
          </p>
          {user.role === "owner" && (
            <label>
              Exact provider receipt
              <input
                value={receipt}
                onChange={(event) => {
                  setReceipt(event.target.value);
                }}
                placeholder="Postal message ID or Discord receipt"
              />
            </label>
          )}
        </>
      )}
      {["unknown", "sending", "accepted"].includes(delivery.state) && (
        <button
          className="button"
          disabled={action.isPending}
          onClick={() => {
            action.mutate("reconcile");
          }}
        >
          Check provider receipt
        </button>
      )}
      {action.error !== null && <ErrorNotice error={action.error} />}
    </div>
  );
}
