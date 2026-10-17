import type { MediaDetail } from "#shared/api.ts";
import type { MediaAction, MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { useTargetCommand } from "./target-controls/mutation.ts";
import { CommandError, commandNeedsReview } from "./target-controls/errors.tsx";

const actionLabels: Record<MediaAction["action"], string> = {
  keep: "Keep for 30 days",
  pin: "Pin indefinitely",
  unpin: "Remove pin",
  restore: "Restore to library",
  remove: "Remove from library",
  retry: "Retry acquisition",
  select_release: "Select release",
};

export function MediaActionButton({
  user,
  context,
  action,
  confirmation,
}: {
  user: MediaUser;
  context: DefaultTargetView;
  action: Exclude<MediaAction["action"], "select_release">;
  confirmation?: NonNullable<MediaDetail["removalConfirmation"]>;
}) {
  const mutation = useTargetCommand(user.id);
  return (
    <div className="action-control">
      <button
        className={`button ${action === "keep" || action === "restore" ? "primary" : "subtle"}`}
        disabled={
          mutation.isPending ||
          mutation.isSuccess ||
          commandNeedsReview(mutation.error)
        }
        onClick={() => {
          mutation.submit({
            context,
            command: {
              action,
              ...(action === "remove" && confirmation !== undefined
                ? { confirmation }
                : {}),
            },
          });
        }}
      >
        {mutation.isPending ? "Saving…" : actionLabels[action]}
      </button>
      <CommandError
        error={mutation.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      {mutation.isSuccess && (
        <span className="helper" role="status">
          {mutation.data.result.status === "completed"
            ? "Saved"
            : "Action queued"}
        </span>
      )}
    </div>
  );
}
