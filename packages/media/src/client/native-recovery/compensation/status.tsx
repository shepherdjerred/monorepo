import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { NativeCompensationContinuationViewSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi } from "#client/api.ts";
import { Button } from "#client/ui/button.tsx";
import { DataRow } from "#client/ui/data-list.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import { WriteFailure } from "#client/ui/workflow.tsx";
import { phrase } from "#client/native-recovery/vocabulary.ts";

type Item = z.infer<typeof NativeCompensationContinuationViewSchema>;

const PUBLICATION = {
  held: { label: "Waiting", tone: "warn" },
  ready: { label: "Ready to publish", tone: "neutral" },
  publishing: { label: "In progress", tone: "progress" },
  protected: { label: "Stopped: needs your review", tone: "danger" },
  available: { label: "Verified in Plex", tone: "ok" },
} satisfies Record<
  Item["publicationState"],
  { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "progress" }
>;

/**
 * Where the restoration stands, by what the server reports: only work that is
 * publishing is in progress. A restoration the server holds in protection, or
 * whose publication failed, was cancelled or is being reconciled, has stopped.
 */
function restorationBadge(item: Item) {
  return item.state === "protected"
    ? PUBLICATION.protected
    : PUBLICATION[item.publicationState];
}

/** One interrupted upgrade's restoration: where the files and playback stand, and a retry. */
export function CompensationStatus({
  user,
  item,
  onRefresh,
}: {
  user: MediaUser;
  item: z.infer<typeof NativeCompensationContinuationViewSchema>;
  onRefresh: () => void;
}) {
  const retry = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: `/admin/native-recovery/compensations/${item.id}/retry`,
        schema: CommandResultSchema,
        body: { expectedVersion: item.version },
      }),
    onSuccess: onRefresh,
  });
  const badge = restorationBadge(item);
  return (
    <DataRow
      title={item.media.map((media) => media.title).join(", ")}
      detail={
        <>
          <p>
            File restoration: {phrase(item.state).toLowerCase()}. Playback:{" "}
            {phrase(item.publicationState).toLowerCase()}.
          </p>
          {item.fenceActive && (
            <p>
              Conflicting file changes remain blocked until restoration, current
              household approval, and fresh Plex verification are complete.
            </p>
          )}
          {item.protectedReason !== null && (
            <p>{phrase(item.protectedReason)}</p>
          )}
          {item.state === "compensated" &&
            item.publicationState !== "available" && (
              <p>
                Predecessor files are restored but are not yet marked available.
                Every covered title needs current positive household authority
                before Plex verification. Mixed or missing choices remain
                protected.
              </p>
            )}
          {item.publicationState === "available" && (
            <p>
              Plex has verified the restored files for all covered titles. The
              restoration protection has been released.
            </p>
          )}
          {item.fenceActive && (
            <p>
              A retry first checks that earlier work has stopped and that
              current protection permits the same reviewed restoration.
            </p>
          )}
        </>
      }
      status={<Badge tone={badge.tone}>{badge.label}</Badge>}
      actions={
        item.fenceActive ? (
          <Button
            busy={retry.isPending}
            onClick={() => {
              retry.mutate();
            }}
          >
            {retry.isPending
              ? "Checking previous work…"
              : "Check and retry current restoration"}
          </Button>
        ) : undefined
      }
    >
      {retry.error !== null && (
        <WriteFailure
          error={retry.error}
          refused={{
            title: "The retry was not submitted",
            state:
              "The request was refused, so nothing was changed. Refresh the review to see its current state.",
          }}
          unknown={{
            title: "Whether the retry was submitted is not known",
            about: "whether the retry was recorded",
            check: "refresh the review to see where the restoration stands",
          }}
          action={<Button onClick={onRefresh}>Refresh the review</Button>}
        />
      )}
    </DataRow>
  );
}
