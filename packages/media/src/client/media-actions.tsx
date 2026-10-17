import { useMutation } from "@tanstack/react-query";
import { CommandResultSchema, type MediaDetail } from "#shared/api.ts";
import type { MediaAction, MediaUser } from "#shared/contract.ts";
import { queryClient, writeApi } from "./api.ts";
import { ErrorNotice } from "./components.tsx";

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
  mediaId,
  version,
  action,
  confirmation,
}: {
  user: MediaUser;
  mediaId: string;
  version: number;
  action: Exclude<MediaAction["action"], "select_release">;
  confirmation?: NonNullable<MediaDetail["removalConfirmation"]>;
}) {
  const mutation = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: `/media/${encodeURIComponent(mediaId)}/actions`,
        body: {
          action,
          expectedVersion: version,
          ...(action === "remove" && confirmation !== undefined
            ? { confirmation }
            : {}),
        },
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["media", mediaId] }),
        queryClient.invalidateQueries({ queryKey: ["removals"] }),
        queryClient.invalidateQueries({ queryKey: ["activity"] }),
      ]);
    },
  });
  return (
    <div className="action-control">
      <button
        className={`button ${action === "keep" || action === "restore" ? "primary" : "subtle"}`}
        disabled={mutation.isPending}
        onClick={() => {
          mutation.mutate();
        }}
      >
        {mutation.isPending ? "Saving…" : actionLabels[action]}
      </button>
      {mutation.error !== null && <ErrorNotice error={mutation.error} />}
      {mutation.isSuccess && (
        <span className="helper" role="status">
          {mutation.data.status === "completed" ? "Saved" : "Action queued"}
        </span>
      )}
    </div>
  );
}
