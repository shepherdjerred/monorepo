import { useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  IdentityConfirmationSchema,
  type IdentityPreview,
} from "#shared/acquisition/preview.ts";
import { ApiError } from "#client/api.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { useTargetCommand } from "#client/target-controls/mutation.ts";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import { ErrorNotice, Notice, humanize } from "#client/components.tsx";
import { CoveragePicker } from "./coverage.tsx";
import { identityPreviewOptions } from "./preview.ts";
import type {
  DefaultEditionDecision,
  CutReason,
} from "#shared/editions/evidence.ts";

type ReviewProps = {
  user: MediaUser;
  mediaId: string;
  releaseId: string;
  initialCoverage: string[];
  context: DefaultTargetView;
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
  context,
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
        resolves identity only; cut and quality requirements still apply.
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
          preview.mutate({ mediaIds: [...selected], context });
        }}
      >
        Review this coverage
      </button>
      <CommandError
        error={preview.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      {preview.data !== undefined && (
        <ConfirmIdentity
          key={preview.data.preview.previewDigest}
          user={user}
          mediaId={mediaId}
          preview={preview.data.preview}
          context={preview.data.context}
        />
      )}
    </div>
  );
}

function ConfirmIdentity({
  user,
  mediaId,
  preview,
  context,
}: {
  user: MediaUser;
  mediaId: string;
  preview: IdentityPreview;
  context: DefaultTargetView;
}) {
  const [error, setError] = useState<Error | null>(null);
  const confirm = useTargetCommand(user.id);
  function confirmIdentity(reason: string) {
    const requested = preview.media.find((item) => item.id === mediaId);
    if (requested === undefined)
      throw new Error("Reviewed coverage omits the requested item.");
    if (requested.version !== context.expected.mediaVersion)
      throw new ApiError(
        "version_conflict",
        "The reviewed title changed. Prepare a new review.",
        409,
      );
    const confirmation = IdentityConfirmationSchema.parse({
      previewDigest: preview.previewDigest,
      candidateDigest: preview.candidateDigest,
      mediaIds: preview.media.map((item) => item.id),
      numberingDigest: preview.numberingDigest,
      reason,
      acknowledgeIdentity: true,
    });
    confirm.submit({
      context,
      command: {
        action: "select_release",
        releaseId: preview.releaseId,
        identityConfirmation: confirmation,
      },
    });
  }
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
    try {
      confirmIdentity(reason);
    } catch (error_) {
      if (!(error_ instanceof Error)) throw error_;
      setError(error_);
    }
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
      <EditionNotice decision={preview.edition} />
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
          !preview.confirmationAllowed ||
          !preview.edition.accepted ||
          confirm.isPending ||
          commandNeedsReview(confirm.error) ||
          confirm.isSuccess
        }
      >
        Confirm identity and select release
      </button>
      {error !== null && <ErrorNotice error={error} />}
      <CommandError
        error={confirm.error}
        review={() => {
          globalThis.location.reload();
        }}
      />
      {confirm.isSuccess && (
        <Notice>
          Selection queued. Acquisition will recheck current access, requests
          and cut and quality requirements before downloading.
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

const CUT_MESSAGES: Record<CutReason, string> = {
  edition_candidate_incompatible:
    "This release contains a named cut. It cannot fulfill a request with no specific edition.",
  edition_evidence_ambiguous:
    "The cut information is uncertain. Identity confirmation cannot resolve this cut blocker.",
  edition_evidence_conflict:
    "The source titles or downloaded files describe conflicting cuts.",
  edition_current_requires_classification:
    "The current file has named or uncertain cut information and is protected from replacement. Owner classification is not available yet.",
};
export function EditionNotice({
  decision,
}: {
  decision: DefaultEditionDecision;
}) {
  if (decision.accepted)
    return (
      <p className="helper">
        No specific edition requested. No conflicting cut evidence was found;
        quality requirements still apply.
      </p>
    );
  return (
    <Notice>
      <strong>Cut evidence blocks this release</strong>
      <ul>
        {decision.reasons.map((reason) => (
          <li key={reason}>{CUT_MESSAGES[reason]}</li>
        ))}
      </ul>
      <p>
        Confirming the movie or episodes does not override these protections.
      </p>
    </Notice>
  );
}
