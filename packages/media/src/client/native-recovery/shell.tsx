import { useRef, type ReactNode } from "react";
import { RotateCwIcon } from "lucide-react";
import { PageTitle } from "#client/components.tsx";
import { Button, ButtonLink, ButtonRow } from "#client/ui/button.tsx";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { Panel } from "#client/ui/panel.tsx";
import {
  ActionFailure,
  Decision,
  TechnicalDetails,
} from "#client/ui/workflow.tsx";
import { phrase } from "./vocabulary.ts";

/** What a review's state means for the owner. The state itself is free text from the server. */
const STATE = {
  preparing: {
    label: "Being prepared",
    tone: "neutral",
    meaning:
      "Workers are inspecting the files, storage, and Plex identity. Nothing is changed, and this page updates itself.",
  },
  awaiting_review: {
    label: "Needs your approval",
    tone: "warn",
    meaning:
      "Nothing has changed. Check what follows, then approve or leave it.",
  },
  applying: {
    label: "Approval queued",
    tone: "neutral",
    meaning:
      "Current content and authority are checked again before anything changes.",
  },
  applied: {
    label: "Applied",
    tone: "ok",
    meaning: "The approved change is recorded.",
  },
} as const;

function stateCopy(state: string) {
  return Object.entries(STATE).find(([name]) => name === state)?.[1] ?? null;
}

/** The title of a review page, where it came from, and how to refresh what it shows. */
export function ReviewHeader({
  title,
  intro,
  back,
  onRefresh,
  refreshing,
  refreshLabel,
  loadError,
}: {
  title: string;
  intro: string;
  back: { to: string; label: string };
  onRefresh: () => void;
  refreshing: boolean;
  /** What refreshing reloads: "Refresh current protection and cleanup status". */
  refreshLabel: string;
  loadError: Error | null;
}) {
  return (
    <>
      <PageTitle title={title}>
        <p>{intro}</p>
        <ButtonRow>
          <ButtonLink to={back.to}>{back.label}</ButtonLink>
          <ButtonLink to="/recovery">Household protection</ButtonLink>
          <Button busy={refreshing} onClick={onRefresh}>
            <RotateCwIcon aria-hidden="true" />
            {refreshing ? "Refreshing…" : refreshLabel}
          </Button>
        </ButtonRow>
      </PageTitle>
      {loadError !== null && (
        <LoadError what="The review" error={loadError} retry={onRefresh} />
      )}
    </>
  );
}

/** Where the review stands, with what is specific to this kind of review under it. */
export function StatePanel({
  state,
  children,
}: {
  state: string;
  children?: ReactNode;
}) {
  const copy = stateCopy(state);
  return (
    <Panel id="state" title={copy === null ? phrase(state) : copy.label}>
      {copy !== null && <Callout tone={copy.tone}>{copy.meaning}</Callout>}
      {children}
    </Panel>
  );
}

/**
 * The owner's decision on a prepared review: what it permits, the
 * acknowledgement, and a button that opens the confirmation. Nothing is sent
 * until the dialog's confirm button is pressed.
 */
export function ApprovalSection({
  title = "Approve this review",
  summary,
  acknowledgement,
  acknowledged,
  onAcknowledge,
  buttonLabel,
  pendingLabel = "Submitting approval…",
  confirmTitle,
  confirmLabel,
  confirmBody,
  onApply,
  pending,
  error,
}: {
  title?: string;
  /** What approving permits, before the acknowledgement. */
  summary: ReactNode;
  acknowledgement: string;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  buttonLabel: string;
  pendingLabel?: string;
  confirmTitle: string;
  confirmLabel: string;
  confirmBody: ReactNode;
  onApply: () => void;
  pending: boolean;
  error: Error | null;
}) {
  const confirm = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Decision title={title}>
        {summary}
        <CheckboxField
          label={acknowledgement}
          checked={acknowledged}
          onChange={(event) => {
            onAcknowledge(event.currentTarget.checked);
          }}
        />
        <div>
          <Button
            variant="primary"
            busy={pending}
            disabled={!acknowledged}
            onClick={() => {
              confirm.current?.showModal();
            }}
          >
            {pending ? pendingLabel : buttonLabel}
          </Button>
        </div>
      </Decision>
      <ConfirmDialog
        ref={confirm}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        danger
        onConfirm={onApply}
      >
        {confirmBody}
      </ConfirmDialog>
      {error !== null && (
        <ActionFailure
          title="The approval was not submitted"
          error={error}
          state="As far as this page can tell, nothing was changed. Refresh the review to confirm."
        />
      )}
    </>
  );
}

/** Expiry and plan digest, as every review's technical details start. */
export function ProofDetails(proof: {
  planHash: string | null;
  expiresAt: string | null;
  children?: ReactNode;
}) {
  return (
    <TechnicalDetails>
      <p>Plan digest: {proof.planHash ?? "pending inspection"}.</p>
      <p>
        Review expires:{" "}
        {proof.expiresAt === null
          ? "not prepared"
          : new Date(proof.expiresAt).toLocaleString()}
        .
      </p>
      {proof.children}
    </TechnicalDetails>
  );
}

/**
 * What must be true before files can be reviewed: each prerequisite the
 * server still lists, or a sentence saying none are outstanding.
 */
export function Prerequisites({
  title = "Before file review",
  intro,
  prerequisites,
  done,
}: {
  title?: string;
  intro: ReactNode;
  prerequisites: readonly string[];
  /** What is said when nothing is outstanding. */
  done: ReactNode;
}) {
  return (
    <Panel id="before" title={title} description={<p>{intro}</p>}>
      {prerequisites.length === 0 ? (
        <Callout tone="ok">{done}</Callout>
      ) : (
        <Callout tone="warn" title="Still to do">
          <ul>
            {prerequisites.map((reason) => (
              <li key={reason}>{phrase(reason)}</li>
            ))}
          </ul>
        </Callout>
      )}
    </Panel>
  );
}

/** The cursor controls of an inventory read a page at a time. */
export function CursorButtons({
  hasPrevious,
  next,
  nextLabel,
  onFirst,
  onNext,
}: {
  hasPrevious: boolean;
  next: string | null;
  nextLabel: string;
  onFirst: () => void;
  onNext: (cursor: string) => void;
}) {
  if (!hasPrevious && next === null) return null;
  return (
    <ButtonRow>
      {hasPrevious && <Button onClick={onFirst}>First page</Button>}
      {next !== null && (
        <Button
          onClick={() => {
            onNext(next);
          }}
        >
          {nextLabel}
        </Button>
      )}
    </ButtonRow>
  );
}
