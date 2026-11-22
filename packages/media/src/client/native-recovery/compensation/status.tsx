import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { NativeCompensationContinuationViewSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi } from "#client/api.ts";
import { ErrorNotice, humanize } from "#client/components.tsx";

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
  return (
    <article>
      <h3>{item.media.map((media) => media.title).join(" · ")}</h3>
      <p>
        File restoration: {humanize(item.state)}. Playback:{" "}
        {humanize(item.publicationState)}.
      </p>
      {item.fenceActive && (
        <p>
          Conflicting file changes remain blocked until restoration, current
          household approval and fresh Plex verification are complete.
        </p>
      )}
      {item.protectedReason !== null && <p>{humanize(item.protectedReason)}</p>}
      {item.state === "compensated" &&
        item.publicationState !== "available" && (
          <p>
            Predecessor files are restored but are not yet marked available.
            Every covered title needs current positive household authority
            before Plex verification. Mixed or missing choices remain protected.
          </p>
        )}
      {item.publicationState === "available" && (
        <p>
          Plex has verified the restored files for all covered titles. The
          restoration protection has been released.
        </p>
      )}
      {item.fenceActive && (
        <>
          <p>
            A retry first checks that earlier work has stopped and that current
            protection permits the same reviewed restoration.
          </p>
          <button
            className="button"
            disabled={retry.isPending}
            onClick={() => {
              retry.mutate();
            }}
          >
            {retry.isPending
              ? "Checking previous work…"
              : "Check and retry current restoration"}
          </button>
        </>
      )}
      {retry.error !== null && <ErrorNotice error={retry.error} />}
    </article>
  );
}
