import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import type { MediaUser } from "#shared/contract.ts";
import { MediaActionButton } from "#client/media-actions.tsx";
import { ErrorNotice, Notice } from "#client/components.tsx";
import { useTarget } from "./api.ts";
import { useTargetCommand } from "./mutation.ts";
import { CommandError, commandNeedsReview } from "./errors.tsx";

export function ProtectionControls({
  user,
  context,
}: {
  user: MediaUser;
  context: DefaultTargetView;
}) {
  return (
    <div className="button-row">
      {context.allowedProtectiveActions
        .filter((action) => action !== "cancel_request")
        .map((action) => (
          <MediaActionButton
            key={action}
            user={user}
            context={context}
            action={action}
          />
        ))}
    </div>
  );
}

export function ProtectionNotice() {
  return (
    <Notice>
      Library details are unavailable with your current access. You can still
      use the request protections shown here.
    </Notice>
  );
}

export function RequestProtection({
  user,
  request,
}: {
  user: MediaUser;
  request: { id: string; mediaId: string; version: number; active: boolean };
}) {
  const target = useTarget(request.mediaId);
  const cancel = useTargetCommand(user.id);
  if (target.error !== null) return <ErrorNotice error={target.error} />;
  if (target.data === undefined)
    return <span className="helper">Loading request controls…</span>;
  const context = target.data;
  const own = context.ownRequests.find((item) => item.id === request.id);
  const canCancel =
    user.role === "owner"
      ? context.allowedProtectiveActions.includes("cancel_request")
      : own?.canCancel === true && own.version === request.version;
  return (
    <div className="action-control">
      {context.access === "protection_only" && (
        <p className="helper">
          Request protections only; library details unavailable.
        </p>
      )}
      <ProtectionControls user={user} context={context} />
      {request.active && canCancel && (
        <button
          className="button subtle"
          disabled={
            cancel.isPending ||
            cancel.isSuccess ||
            commandNeedsReview(cancel.error)
          }
          onClick={() => {
            cancel.submit({
              context,
              command: {
                action: "cancel_request",
                requestId: request.id,
                requestVersion: request.version,
              },
            });
          }}
        >
          {cancel.isPending ? "Cancelling…" : "Cancel request"}
        </button>
      )}
      <CommandError
        error={cancel.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      {cancel.isSuccess && (
        <span className="helper" role="status">
          Request cancelled.
        </span>
      )}
    </div>
  );
}

export function ListedMediaAction({
  user,
  mediaId,
  action,
}: {
  user: MediaUser;
  mediaId: string;
  action: "keep" | "restore";
}) {
  const target = useTarget(mediaId);
  if (target.error !== null) return <ErrorNotice error={target.error} />;
  if (target.data === undefined)
    return <span className="helper">Loading controls…</span>;
  return action === "restore" && target.data.access === "protection_only" ? (
    <ProtectionControls user={user} context={target.data} />
  ) : (
    <MediaActionButton user={user} context={target.data} action={action} />
  );
}
