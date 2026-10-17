import { useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  IdentityConfirmationSchema,
  type IdentityPreview,
} from "#shared/acquisition/preview.ts";
import { writeApi, queryClient } from "#client/api.ts";
import { ErrorNotice, Notice, humanize } from "#client/components.tsx";
import { CoveragePicker } from "./coverage.tsx";
import { identityPreviewOptions } from "./preview.ts";

type ReviewProps = {
  user: MediaUser;
  mediaId: string;
  releaseId: string;
  initialCoverage: string[];
};
export function IdentityReview(props: ReviewProps) {
  const [open, setOpen] = useState(false);
  return open ? (
    <IdentityReviewForm {...props} />
  ) : (
    <button
      className="button"
      type="button"
      onClick={() => {
        setOpen(true);
      }}
    >
      Review identity and episode coverage
    </button>
  );
}
function IdentityReviewForm({
  user,
  mediaId,
  releaseId,
  initialCoverage,
}: ReviewProps) {
  const [selected, setSelected] = useState([
    ...new Set([mediaId, ...initialCoverage]),
  ]);
  const preview = useMutation(
    identityPreviewOptions({ actorId: user.id, mediaId, releaseId }),
  );
  function change(ids: string[]) {
    setSelected(ids);
    preview.reset();
  }
  return (
    <div className="stack-form">
      <h3>Confirm the release identity</h3>
      <p>
        Review which movie or episodes this release contains. Confirmation
        resolves identity only; quality requirements still apply.
      </p>
      <CoveragePicker mediaId={mediaId} selected={selected} onChange={change} />
      <button
        className="button"
        type="button"
        disabled={
          preview.isPending || selected.length === 0 || selected.length > 100
        }
        onClick={() => {
          preview.reset();
          preview.mutate([...selected]);
        }}
      >
        Review this coverage
      </button>
      {preview.error !== null && <ErrorNotice error={preview.error} />}
      {preview.data !== undefined && (
        <ConfirmIdentity
          key={preview.data.previewDigest}
          user={user}
          mediaId={mediaId}
          preview={preview.data}
        />
      )}
    </div>
  );
}

function ConfirmIdentity({
  user,
  mediaId,
  preview,
}: {
  user: MediaUser;
  mediaId: string;
  preview: IdentityPreview;
}) {
  const [error, setError] = useState<Error | null>(null);
  const confirm = useMutation({
    mutationFn: async (reason: string) => {
      const requested = preview.media.find((item) => item.id === mediaId);
      if (requested === undefined)
        throw new Error("Reviewed coverage omits the requested item.");
      const confirmation = IdentityConfirmationSchema.parse({
        previewDigest: preview.previewDigest,
        candidateDigest: preview.candidateDigest,
        mediaIds: preview.media.map((item) => item.id),
        numberingDigest: preview.numberingDigest,
        reason,
        acknowledgeIdentity: true,
      });
      return writeApi({
        actorId: user.id,
        path: `/media/${mediaId}/actions`,
        body: {
          action: "select_release",
          expectedVersion: requested.version,
          releaseId: preview.releaseId,
          identityConfirmation: confirmation,
        },
        schema: CommandResultSchema,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["media", mediaId] });
    },
  });
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const reason = new FormData(event.currentTarget).get("reason");
    if (typeof reason !== "string" || reason.trim().length < 10) {
      setError(
        new Error("Explain the evidence used to identify this release."),
      );
      return;
    }
    confirm.mutate(reason);
  }
  return (
    <form className="panel stack-form" onSubmit={submit}>
      <h4>
        {preview.canonicalTitle} ({preview.canonicalYear})
      </h4>
      <p>
        {preview.title} · {preview.providerId}
      </p>
      {preview.identityReasons.map((reason) => (
        <p className="helper" key={reason}>
          {humanize(reason)}
        </p>
      ))}
      <ul>
        {preview.media.map((item) => {
          const episode =
            preview.canonical.kind === "series"
              ? preview.canonical.coordinates.episodes.find(
                  (row) => row.mediaId === item.id,
                )
              : undefined;
          return (
            <li key={item.id}>
              {episode === undefined
                ? ""
                : `S${String(episode.seasonNumber)} E${String(episode.episodeNumber)} · `}
              {item.title}
              {episode?.absoluteNumber == null
                ? ""
                : ` · release number ${String(episode.absoluteNumber)}`}
            </li>
          );
        })}
      </ul>
      {preview.qualityBlockers.length > 0 && (
        <Notice>
          <strong>Quality still blocks this release</strong>
          <ul>
            {preview.qualityBlockers.map((reason) => (
              <li key={reason}>{humanize(reason)}</li>
            ))}
          </ul>
        </Notice>
      )}
      {!preview.confirmationAllowed && (
        <Notice>
          This release cannot be confirmed with the current evidence. Resolve
          the listed blockers and refresh the review.
        </Notice>
      )}
      <label>
        Evidence for this identification
        <textarea
          name="reason"
          required
          minLength={10}
          maxLength={2000}
          rows={3}
          placeholder="Explain the exact source and canonical episode mapping."
        />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" required />I checked the release and every listed
        episode.
      </label>
      <button
        className="button button-primary"
        disabled={
          !preview.confirmationAllowed || confirm.isPending || confirm.isSuccess
        }
      >
        Confirm identity and select release
      </button>
      {error !== null && <ErrorNotice error={error} />}
      {confirm.error !== null && <ErrorNotice error={confirm.error} />}
      {confirm.isSuccess && (
        <Notice>
          Selection queued. Acquisition will recheck current access, requests
          and quality before downloading.
        </Notice>
      )}
      <details>
        <summary>Identity evidence</summary>
        <p>
          Sponsor request:{" "}
          {preview.sponsorRequestId ?? "None; acquisition cannot start"}
        </p>
        <pre>
          {JSON.stringify(
            {
              references: preview.references,
              numberingDigest: preview.numberingDigest,
              previewDigest: preview.previewDigest,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </form>
  );
}
