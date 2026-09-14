import type { NotificationBlocked } from "#src/lib/operations/operations-notification-actions.ts";

/**
 * Why a row offers no operation, in the register the reason deserves.
 *
 * A domain rule is ordinary detail and reads as such. A contract violation is
 * not: under contract-hash coupling the backend and this SPA ship as one
 * release, so a state this console cannot reason about means they went out of
 * step or a stored row is malformed. Rendering that in the same quiet grey as
 * "this intent has settled" would bury an incident inside a table cell, so it
 * gets error styling, an alert role, and an explicit ask to report it.
 */
export function OperationsBlockedReason(props: {
  blocked: NotificationBlocked;
}) {
  const violation = props.blocked.tone === "contract-violation";
  return (
    <span
      data-blocked-tone={props.blocked.tone}
      {...(violation ? { role: "alert" } : {})}
      className={
        violation
          ? "text-xs font-medium text-scout-danger"
          : "text-xs text-scout-subtle"
      }
    >
      {props.blocked.message}
    </span>
  );
}
