import { Button } from "@shepherdjerred/console-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, SirenIcon, UsersRoundIcon } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  INCIDENT_SYSTEMS,
  IncidentKindSchema,
  IncidentSeveritySchema,
  IncidentSystemSchema,
  type ActorInput,
  type DeclareIncidentInput,
  type DuplicateIncident,
  type IncidentKind,
} from "#shared/contract.ts";
import {
  actingActor,
  incidentsKeys,
  IncidentsApiError,
  mutateIncident,
  viewerQuery,
} from "#client/api.ts";
import {
  KIND_LABEL,
  SEVERITY_HINT,
  SEVERITY_LABEL,
  systemLabel,
} from "#client/format.ts";
import { useNow } from "#client/live.ts";
import { INCIDENTS_BASE_PATH, incidentPath } from "#client/paths.ts";
import {
  ActingAs,
  CommandState,
  errorMessage,
  formText,
  IncidentsHeading,
  Notice,
  SeverityBadge,
  StatusBadge,
  SystemList,
} from "#client/ui.tsx";
import "./incidents.css";

/** `datetime-local` gives wall-clock time in the browser's zone; the wire wants an instant. */
function instant(form: FormData, name: string): string | undefined {
  const value = formText(form, name);
  return value === undefined ? undefined : new Date(value).toISOString();
}

/** The declare input a submitted form describes. */
export function declareInput(
  form: FormData,
  actor: ActorInput,
): DeclareIncidentInput {
  const kind = IncidentKindSchema.parse(form.get("kind"));
  const summary = formText(form, "summary");
  const impact = formText(form, "impact");
  const scheduledStart = instant(form, "scheduledStart");
  const scheduledEnd = instant(form, "scheduledEnd");
  return {
    actor,
    kind,
    title: formText(form, "title") ?? "",
    severity: IncidentSeveritySchema.parse(form.get("severity")),
    systems: form
      .getAll("systems")
      .map((value) => IncidentSystemSchema.parse(value)),
    components: (formText(form, "components") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
    exitCondition: formText(form, "exitCondition") ?? "",
    takeCommand: form.get("takeCommand") === "on",
    ...(summary === undefined ? {} : { summary }),
    ...(impact === undefined ? {} : { impact }),
    ...(kind === "maintenance" && scheduledStart !== undefined
      ? { scheduledStart }
      : {}),
    ...(kind === "maintenance" && scheduledEnd !== undefined
      ? { scheduledEnd }
      : {}),
  };
}

/** The open incident a declaration collided with, and the way to join it. */
export function DuplicateNotice({
  duplicate,
  nowMs,
  pending,
  onJoin,
}: {
  readonly duplicate: DuplicateIncident;
  readonly nowMs: number;
  readonly pending: boolean;
  readonly onJoin: () => void;
}): React.JSX.Element {
  const { existing } = duplicate;
  // The form is submitted from its bottom; move focus and view to the answer
  // once, when the notice mounts (a stable ref runs only then).
  const revealOnMount = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.focus();
    heading?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <section
      className="inc-duplicate"
      aria-labelledby="inc-duplicate-title"
      role="alert"
    >
      <h2
        id="inc-duplicate-title"
        className="ui-section-title"
        tabIndex={-1}
        ref={revealOnMount}
      >
        {existing.identifier} already covers{" "}
        {duplicate.systems.map((system) => systemLabel(system)).join(", ")}
      </h2>
      <p>
        One open incident holds each system, so agents coordinate on a single
        owner. Join it as affected instead of declaring another.
      </p>
      <div className="inc-duplicate-card">
        <Link className="inc-row-link" to={incidentPath(existing.number)}>
          <span className="inc-id">{existing.identifier}</span>
          <span className="inc-title">{existing.title}</span>
        </Link>
        <div className="inc-duplicate-meta">
          <SeverityBadge severity={existing.severity} />
          <StatusBadge status={existing.status} />
          <SystemList systems={existing.systems} />
        </div>
        <CommandState command={existing.command} nowMs={nowMs} />
      </div>
      <div className="inc-form-actions">
        <Button variant="primary" disabled={pending} onClick={onJoin}>
          <UsersRoundIcon aria-hidden="true" />
          Join it instead
        </Button>
        <Link className="ui-btn" to={incidentPath(existing.number)}>
          Open {existing.identifier}
        </Link>
      </div>
    </section>
  );
}

function Choice({
  name,
  value,
  label,
  hint,
  type,
  checked,
  defaultChecked,
  onChange,
}: {
  readonly name: string;
  readonly value: string;
  readonly label: React.ReactNode;
  readonly hint?: string;
  readonly type: "radio" | "checkbox";
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly onChange?: () => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="inc-choice">
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        {...(checked === undefined ? {} : { checked })}
        {...(defaultChecked === undefined ? {} : { defaultChecked })}
        {...(onChange === undefined ? {} : { onChange })}
      />
      <label htmlFor={id}>
        {label}
        {hint === undefined ? null : (
          <span className="ui-muted"> — {hint}</span>
        )}
      </label>
    </div>
  );
}

function TextField({
  name,
  label,
  hint,
  multiline = false,
  required = false,
  ...rest
}: {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly multiline?: boolean;
  readonly required?: boolean;
  readonly type?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const shared = {
    id,
    name,
    required,
    className: "ui-field-control",
    ...(hint === undefined ? {} : { "aria-describedby": hintId }),
  };
  return (
    <div className="ui-field">
      <div className="ui-field-box">
        <label className="ui-field-label" htmlFor={id}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {multiline ? (
          <textarea {...shared} {...rest} rows={3} />
        ) : (
          <input {...shared} {...rest} />
        )}
      </div>
      {hint === undefined ? null : (
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function DeclareIncidentPage(): React.JSX.Element {
  const viewer = useQuery(viewerQuery());
  const viewerValue = viewer.data ?? null;
  const actor = actingActor(viewerValue);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nowMs = useNow();
  const [kind, setKind] = useState<IncidentKind>("incident");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateIncident | null>(null);

  const declare = async (form: HTMLFormElement) => {
    if (new FormData(form).getAll("systems").length === 0) {
      setError("Choose at least one affected system.");
      form.querySelector<HTMLInputElement>('input[name="systems"]')?.focus();
      return;
    }
    setPending(true);
    setError(null);
    setDuplicate(null);
    try {
      const created = await mutateIncident(
        "declare",
        declareInput(new FormData(form), actor),
      );
      await queryClient.invalidateQueries({ queryKey: incidentsKeys.all });
      void navigate(incidentPath(created.number));
    } catch (error_: unknown) {
      if (
        error_ instanceof IncidentsApiError &&
        error_.conflict?.code === "duplicate-incident"
      )
        setDuplicate(error_.conflict);
      else setError(errorMessage(error_));
    } finally {
      setPending(false);
    }
  };

  const join = async (existing: DuplicateIncident["existing"]) => {
    setPending(true);
    try {
      await mutateIncident("join", { actor, ref: existing.identifier });
      await queryClient.invalidateQueries({ queryKey: incidentsKeys.all });
      void navigate(incidentPath(existing.number));
    } catch (error_: unknown) {
      setError(errorMessage(error_));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="inc-page">
      <title>Declare incident · Hub</title>
      <Link className="back-link" to={INCIDENTS_BASE_PATH}>
        <ArrowLeftIcon aria-hidden="true" />
        Incidents
      </Link>
      <IncidentsHeading
        eyebrow="Incidents · new record"
        title="Declare incident"
      />
      <ActingAs viewer={viewerValue} actor={actor} />
      {duplicate === null ? null : (
        <DuplicateNotice
          duplicate={duplicate}
          nowMs={nowMs}
          pending={pending}
          onJoin={() => void join(duplicate.existing)}
        />
      )}
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      <form
        className="inc-panel inc-declare"
        aria-label="Declare incident"
        onSubmit={(event) => {
          event.preventDefault();
          void declare(event.currentTarget);
        }}
      >
        <fieldset className="inc-fieldset">
          <legend>Kind</legend>
          {IncidentKindSchema.options.map((option) => (
            <Choice
              key={option}
              type="radio"
              name="kind"
              value={option}
              label={KIND_LABEL[option]}
              hint={
                option === "incident"
                  ? "something shared is broken"
                  : "planned work"
              }
              checked={kind === option}
              onChange={() => {
                setKind(option);
              }}
            />
          ))}
        </fieldset>
        <TextField
          name="title"
          label="Title"
          required
          minLength={3}
          maxLength={200}
        />
        <fieldset className="inc-fieldset">
          <legend>Severity</legend>
          {IncidentSeveritySchema.options.map((option) => (
            <Choice
              key={option}
              type="radio"
              name="severity"
              value={option}
              label={<strong>{SEVERITY_LABEL[option]}</strong>}
              hint={SEVERITY_HINT[option]}
              defaultChecked={option === "sev2"}
            />
          ))}
        </fieldset>
        <fieldset className="inc-fieldset inc-systems-field">
          <legend>
            Systems <span aria-hidden="true">*</span>
          </legend>
          <p className="ui-field-hint">
            One open incident holds each system; pick every one that is broken.
          </p>
          <div className="inc-choice-grid">
            {INCIDENT_SYSTEMS.map((system) => (
              <Choice
                key={system}
                type="checkbox"
                name="systems"
                value={system}
                label={systemLabel(system)}
              />
            ))}
          </div>
        </fieldset>
        <TextField
          name="components"
          label="Components"
          hint="Comma-separated workloads, for example temporal-workers, delivery-api."
        />
        <TextField
          name="summary"
          label="What is happening"
          multiline
          maxLength={20_000}
        />
        <TextField name="impact" label="Impact" multiline maxLength={5000} />
        <TextField
          name="exitCondition"
          label="Exit condition"
          hint="The observable state that ends this record."
          multiline
          required
          minLength={3}
          maxLength={5000}
        />
        {kind === "maintenance" ? (
          <fieldset className="inc-fieldset inc-window">
            <legend>Window (your local time)</legend>
            <TextField
              name="scheduledStart"
              label="Starts"
              type="datetime-local"
            />
            <TextField name="scheduledEnd" label="Ends" type="datetime-local" />
          </fieldset>
        ) : null}
        <Choice
          type="checkbox"
          name="takeCommand"
          value="on"
          label="Take command now (I am handling it)"
        />
        <div className="inc-form-actions">
          <Button type="submit" variant="primary" disabled={pending}>
            <SirenIcon aria-hidden="true" />
            {pending
              ? "Declaring…"
              : `Declare ${kind === "incident" ? "incident" : "maintenance"}`}
          </Button>
        </div>
      </form>
    </main>
  );
}
