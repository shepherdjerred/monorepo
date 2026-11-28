/**
 * Status, update, link, and resolution commands. Revisioned commands send the
 * loaded record's `revision`; a stale one comes back as CONFLICT, the page
 * refetches, and the message says so.
 */
import { Button } from "@shepherdjerred/console-ui";
import {
  CheckCircle2Icon,
  LinkIcon,
  RotateCcwIcon,
  SendIcon,
} from "lucide-react";
import { useId, useState } from "react";
import {
  IncidentLinkKindSchema,
  type IncidentStatus,
} from "#shared/contract.ts";
import {
  commandActions,
  resolveVerb,
  STATUS_LABEL,
  statusMoves,
} from "#client/format.ts";
import { required, type ActionProps } from "#client/detail-command.tsx";
import { ActionDialog, errorMessage, formText } from "#client/ui.tsx";

export function StatusControl({
  incident,
  actor,
  run,
  report,
}: ActionProps): React.JSX.Element | null {
  const moves = statusMoves(incident.kind, incident.status);
  const [target, setTarget] = useState<IncidentStatus | "">("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  if (moves.length === 0) return null;
  const noteRequired = target === "canceled";

  const submit = async (status: IncidentStatus) => {
    setPending(true);
    report(null);
    try {
      await run("changeStatus", {
        actor,
        ref: incident.identifier,
        expectedRevision: incident.revision,
        status,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
      report({ tone: "ok", text: `Status is now ${STATUS_LABEL[status]}.` });
      setTarget("");
      setNote("");
    } catch (error: unknown) {
      report({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="inc-inline-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (target !== "") void submit(target);
      }}
    >
      <h3 id={`${id}-title`}>Change status</h3>
      <div className="inc-form-row">
        <div className="ui-field">
          <div className="ui-field-box">
            <label className="ui-field-label" htmlFor={`${id}-status`}>
              New status
            </label>
            <select
              id={`${id}-status`}
              className="ui-field-control"
              value={target}
              required
              onChange={(event) => {
                const next = moves.find((move) => move === event.target.value);
                setTarget(next ?? "");
              }}
            >
              <option value="">Choose…</option>
              {moves.map((move) => (
                <option key={move} value={move}>
                  {STATUS_LABEL[move]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ui-field inc-grow">
          <div className="ui-field-box">
            <label className="ui-field-label" htmlFor={`${id}-note`}>
              Note{noteRequired ? " (required to cancel)" : " (optional)"}
            </label>
            <input
              id={`${id}-note`}
              className="ui-field-control"
              value={note}
              required={noteRequired}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          Change status
        </Button>
      </div>
    </form>
  );
}

export function UpdateComposer({
  incident,
  actor,
  run,
  report,
}: ActionProps): React.JSX.Element {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();

  const submit = async (text: string) => {
    setPending(true);
    report(null);
    try {
      await run("postUpdate", {
        actor,
        ref: incident.identifier,
        expectedRevision: incident.revision,
        body: text,
      });
      setBody("");
      report({ tone: "ok", text: "Update posted." });
    } catch (error: unknown) {
      // The draft stays in the box, so a stale-revision retry loses nothing.
      report({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="inc-inline-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        const text = body.trim();
        if (text !== "") void submit(text);
      }}
    >
      <h3 id={`${id}-title`}>Post an update</h3>
      <div className="ui-field">
        <div className="ui-field-box">
          <label className="ui-field-label" htmlFor={`${id}-body`}>
            Update for the timeline
          </label>
          <textarea
            id={`${id}-body`}
            className="ui-field-control"
            rows={3}
            required
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
        </div>
      </div>
      <div className="inc-form-actions">
        <Button type="submit" variant="primary" disabled={pending}>
          <SendIcon aria-hidden="true" />
          Post update
        </Button>
      </div>
    </form>
  );
}

const LINK_KINDS = IncidentLinkKindSchema.options;

export function AddLinkForm({
  incident,
  actor,
  run,
  report,
}: ActionProps): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const id = useId();

  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const url = formText(data, "url");
    const title = formText(data, "title");
    setPending(true);
    report(null);
    try {
      await run("addLink", {
        actor,
        ref: incident.identifier,
        link: {
          kind: IncidentLinkKindSchema.parse(data.get("kind")),
          ref: required(data, "ref"),
          ...(url === undefined ? {} : { url }),
          ...(title === undefined ? {} : { title }),
        },
      });
      form.reset();
      report({ tone: "ok", text: "Link added." });
    } catch (error: unknown) {
      report({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="inc-inline-form inc-link-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <h3 id={`${id}-title`}>Add a link</h3>
      <div className="inc-form-row">
        <div className="ui-field">
          <div className="ui-field-box">
            <label className="ui-field-label" htmlFor={`${id}-kind`}>
              Kind
            </label>
            <select
              id={`${id}-kind`}
              name="kind"
              className="ui-field-control"
              defaultValue="pr"
            >
              {LINK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ui-field">
          <div className="ui-field-box">
            <label className="ui-field-label" htmlFor={`${id}-ref`}>
              Reference <span aria-hidden="true">*</span>
            </label>
            <input
              id={`${id}-ref`}
              name="ref"
              className="ui-field-control"
              required
              placeholder="5145, AI-123, FM-12"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="ui-field inc-grow">
          <div className="ui-field-box">
            <label className="ui-field-label" htmlFor={`${id}-url`}>
              URL (optional)
            </label>
            <input
              id={`${id}-url`}
              name="url"
              type="url"
              className="ui-field-control"
            />
          </div>
        </div>
        <div className="ui-field inc-grow">
          <div className="ui-field-box">
            <label className="ui-field-label" htmlFor={`${id}-title-input`}>
              Title (optional)
            </label>
            <input
              id={`${id}-title-input`}
              name="title"
              className="ui-field-control"
            />
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          <LinkIcon aria-hidden="true" />
          Add link
        </Button>
      </div>
    </form>
  );
}

export function ResolutionControls({
  incident,
  actor,
  nowMs,
  run,
  report,
}: ActionProps): React.JSX.Element | null {
  const actions = commandActions(incident, actor.key, nowMs);
  const ref = incident.identifier;
  const verb = resolveVerb(incident.kind);
  if (!actions.canResolve && !actions.canReopen) return null;
  return (
    <>
      {actions.canResolve ? (
        <ActionDialog
          label={verb}
          icon={CheckCircle2Icon}
          variant="primary"
          title={`${verb} ${ref}`}
          description={
            actions.isCommander
              ? `Record the evidence that the exit condition holds: ${incident.exitCondition}`
              : `You are not the commander, so this is recorded as forced. Exit condition: ${incident.exitCondition}`
          }
          submitLabel={verb}
          noteLabel="Resolution note (evidence)"
          noteRequired
          onSubmit={async (form) => {
            await run("resolve", {
              actor,
              ref,
              expectedRevision: incident.revision,
              note: required(form, "note"),
              force: !actions.isCommander,
            });
            report({
              tone: "ok",
              text: `${ref} is ${verb === "Resolve" ? "resolved" : "completed"}.`,
            });
          }}
        />
      ) : null}
      {actions.canReopen ? (
        <ActionDialog
          label="Reopen"
          icon={RotateCcwIcon}
          title={`Reopen ${ref}`}
          description="Reopening returns the record to work and re-checks that no other open incident holds its systems."
          submitLabel="Reopen"
          noteLabel="Why it is back"
          noteRequired
          onSubmit={async (form) => {
            await run("reopen", {
              actor,
              ref,
              expectedRevision: incident.revision,
              note: required(form, "note"),
            });
            report({ tone: "ok", text: `${ref} reopened.` });
          }}
        />
      ) : null}
    </>
  );
}
