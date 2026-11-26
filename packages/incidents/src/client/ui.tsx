/**
 * Small pieces every incident page shares. Colour always comes with a word
 * (`StatusGlyph` keeps its label), so severity and state never rely on hue.
 */
import { Button, StatusGlyph } from "@shepherdjerred/console-ui";
import { RadioIcon, type LucideIcon } from "lucide-react";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import type {
  ActorInput,
  Command,
  IncidentKind,
  IncidentSeverity,
  IncidentStatus,
  IncidentSystem,
} from "#shared/contract.ts";
import { IncidentsApiError } from "#client/api.ts";
import {
  actorLabel,
  describeCommand,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  statusTone,
  systemLabel,
} from "#client/format.ts";
import { describeFrame, type StreamSnapshot } from "#client/live.ts";

export function SeverityBadge({
  severity,
}: {
  readonly severity: IncidentSeverity;
}): React.JSX.Element {
  return (
    <span className="inc-sev" data-sev={SEVERITY_TONE[severity]}>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusBadge({
  status,
}: {
  readonly status: IncidentStatus;
}): React.JSX.Element {
  return (
    <StatusGlyph severity={statusTone(status)} label={STATUS_LABEL[status]} />
  );
}

export function CommandState({
  command,
  kind,
  nowMs,
  withDetail = false,
}: {
  readonly command: Command;
  readonly kind: IncidentKind;
  readonly nowMs: number;
  readonly withDetail?: boolean;
}): React.JSX.Element {
  const view = describeCommand(command, nowMs, kind);
  return (
    <span className="inc-command" data-state={view.state}>
      <StatusGlyph severity={view.tone} label={view.label} />
      {withDetail && view.detail !== null ? (
        <span className="inc-command-detail">{view.detail}</span>
      ) : null}
    </span>
  );
}

export function SystemList({
  systems,
}: {
  readonly systems: readonly IncidentSystem[];
}): React.JSX.Element {
  return (
    <span className="inc-systems">
      {systems.map((system) => (
        <span key={system} className="inc-system">
          {systemLabel(system)}
        </span>
      ))}
    </span>
  );
}

export function IncidentsHeading({
  eyebrow,
  title,
  compact = false,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  /** A smaller title, for incident titles rather than page names. */
  readonly compact?: boolean;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="page-heading inc-heading"
      data-compact={compact ? "" : undefined}
    >
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children === undefined ? null : (
        <div className="heading-actions">{children}</div>
      )}
    </div>
  );
}

/** Who the browser's commands are attributed to. */
export function ActingAs({
  viewer,
  actor,
}: {
  readonly viewer: ActorInput | null;
  readonly actor: ActorInput;
}): React.JSX.Element {
  return (
    <p className="inc-acting">
      Acting as <strong>{actorLabel(actor)}</strong>
      {viewer === null ? " (no Tailscale identity on this request)" : null}
    </p>
  );
}

/**
 * The live indicator and the polite live region that announces stream
 * frames. The text is visible, so sighted users see the same update.
 */
export function LiveStatus({
  snapshot,
}: {
  readonly snapshot: StreamSnapshot;
}): React.JSX.Element {
  return (
    <p
      className="inc-live"
      data-connected={snapshot.connected ? "" : undefined}
    >
      <RadioIcon aria-hidden="true" />
      <span>{snapshot.connected ? "Live" : "Reconnecting…"}</span>
      <span role="status" className="inc-live-text">
        {snapshot.lastFrame === null
          ? ""
          : `Updated ${describeFrame(snapshot.lastFrame)}`}
      </span>
    </p>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof IncidentsApiError) {
    return error.conflict?.code === "stale-revision"
      ? `${error.conflict.incident.identifier} changed while you were working (now revision ${String(error.conflict.incident.revision)}). The latest version is loaded; check it and try again.`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function Notice({
  tone,
  children,
}: {
  readonly tone: "error" | "warning" | "ok";
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="inc-notice" data-sev={tone} role="alert">
      {children}
    </div>
  );
}

export type ActionDialogProps = {
  /** Text of the button that opens the dialog. */
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly variant?: "default" | "primary";
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly noteLabel: string;
  readonly noteRequired: boolean;
  /** Extra fields rendered above the note. */
  readonly children?: ReactNode;
  /** Resolve to close the dialog; throw to keep it open with the message. */
  readonly onSubmit: (form: FormData) => Promise<void>;
};

/**
 * A command that needs a reason (resolve, reopen, hand off, force) as a
 * native modal `<dialog>`: the browser supplies focus containment, `Esc`,
 * and focus return to the opening button.
 */
export function ActionDialog({
  label,
  icon,
  variant = "default",
  title,
  description,
  submitLabel,
  noteLabel,
  noteRequired,
  children,
  onSubmit,
}: ActionDialogProps): React.JSX.Element {
  const Icon = icon;
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The form exists only while the dialog is open, so a page never carries
  // hidden dialog headings and every opening starts from an empty form.
  const [open, setOpen] = useState(false);
  // React's autoFocus fires on mount, not on showModal; the form mounts
  // after showModal, so focusing its first field here lands correctly.
  const focusFirstField = useCallback((form: HTMLFormElement | null) => {
    form?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const submit = async (form: HTMLFormElement) => {
    setPending(true);
    setError(null);
    try {
      await onSubmit(new FormData(form));
      dialog.current?.close();
    } catch (error_: unknown) {
      setError(errorMessage(error_));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          setError(null);
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {Icon === undefined ? null : <Icon aria-hidden="true" />}
        {label}
      </Button>
      <dialog
        ref={dialog}
        className="inc-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => {
          setOpen(false);
        }}
      >
        {open ? (
          <form
            ref={focusFirstField}
            method="dialog"
            className="inc-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(event.currentTarget);
            }}
          >
            <h1 id={titleId} className="inc-dialog-title">
              {title}
            </h1>
            <p id={descriptionId} className="inc-dialog-description">
              {description}
            </p>
            {children}
            <div className="ui-field">
              <div className="ui-field-box">
                <label className="ui-field-label" htmlFor={`${id}-note`}>
                  {noteLabel}
                  {noteRequired ? <span aria-hidden="true"> *</span> : null}
                </label>
                <textarea
                  id={`${id}-note`}
                  name="note"
                  className="ui-field-control"
                  required={noteRequired}
                  rows={4}
                  aria-describedby={error === null ? undefined : errorId}
                />
              </div>
            </div>
            {error === null ? null : (
              <p id={errorId} className="inc-dialog-error" role="alert">
                {error}
              </p>
            )}
            <div className="inc-dialog-actions">
              <Button
                onClick={() => {
                  dialog.current?.close();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Working…" : submitLabel}
              </Button>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}

/** A trimmed form value, or undefined when blank. */
export function formText(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
