/**
 * The command panel: who holds the incident and the claims the viewer may
 * make. `take` carries no revision by contract (the server re-decides it
 * against the current record); hand-off and release send the loaded
 * `revision` and fail with a stale-revision CONFLICT when it moved.
 */
import { Button } from "@shepherdjerred/console-ui";
import {
  HandIcon,
  ShieldAlertIcon,
  UserRoundXIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useId, useState } from "react";
import type {
  ActorInput,
  IncidentDetail,
  TakeCommandResult,
} from "#shared/contract.ts";
import type {
  IncidentMutation,
  MutationInput,
  MutationOutput,
} from "#client/api.ts";
import { commandActions, formatInstant } from "#client/format.ts";
import {
  ActionDialog,
  CommandState,
  errorMessage,
  formText,
} from "#client/ui.tsx";

export type RunCommand = <K extends IncidentMutation>(
  name: K,
  input: MutationInput<K>,
) => Promise<MutationOutput<K>>;

export type PageNotice = {
  readonly tone: "ok" | "warning" | "error";
  readonly text: string;
};

export type ActionProps = {
  readonly incident: IncidentDetail;
  readonly actor: ActorInput;
  readonly nowMs: number;
  readonly run: RunCommand;
  readonly report: (notice: PageNotice | null) => void;
};

export function takeOutcome(
  result: TakeCommandResult,
  nowMs: number,
): PageNotice {
  const id = result.incident.identifier;
  if (result.outcome === "owned")
    return { tone: "ok", text: `You hold command of ${id}.` };
  if (result.outcome === "dispatching")
    return { tone: "ok", text: `Dispatch lease taken for ${id}.` };
  if (result.reason === "owned-by-other")
    return {
      tone: "warning",
      text: `${id} already has a commander. Use Force take to displace them.`,
    };
  if (result.reason === "dispatch-in-progress")
    return {
      tone: "warning",
      text: `A commander session is being dispatched for ${id}. Use Force take to override the lease.`,
    };
  return {
    tone: "warning",
    text: `${id} is not eligible for takeover until ${formatInstant(result.incident.command.takeoverEligibleAt, nowMs)}. Use Force take to override.`,
  };
}

export function required(form: FormData, name: string): string {
  const value = formText(form, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

export function CommandPanel({
  incident,
  actor,
  nowMs,
  run,
  report,
}: ActionProps): React.JSX.Element {
  const actions = commandActions(incident, actor.key, nowMs);
  const [pending, setPending] = useState(false);
  const ref = incident.identifier;

  const take = async () => {
    setPending(true);
    report(null);
    try {
      report(takeOutcome(await run("take", { actor, ref }), nowMs));
    } catch (error: unknown) {
      report({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      className="inc-panel inc-command-panel"
      aria-labelledby="inc-command-title"
    >
      <h2 className="ui-section-title inc-panel-title" id="inc-command-title">
        Command
      </h2>
      <div className="inc-command-body">
        <CommandState command={incident.command} nowMs={nowMs} withDetail />
        <p className="ui-muted">
          Takeover eligible{" "}
          <time dateTime={incident.command.takeoverEligibleAt}>
            {formatInstant(incident.command.takeoverEligibleAt, nowMs)}
          </time>
          .
        </p>
      </div>
      <div className="ui-toolbar inc-actions">
        {actions.canTake ? (
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => void take()}
          >
            <HandIcon aria-hidden="true" />
            Take command
          </Button>
        ) : null}
        {actions.canForce ? (
          <ActionDialog
            label="Force take"
            icon={ShieldAlertIcon}
            title={`Force take ${ref}`}
            description="Force bypasses the takeover grace and displaces any commander or dispatch lease. The timeline records what it overrode."
            submitLabel="Force take command"
            noteLabel="Why you are overriding"
            noteRequired
            onSubmit={async (form) => {
              const result = await run("take", {
                actor,
                ref,
                force: true,
                note: required(form, "note"),
              });
              report(takeOutcome(result, nowMs));
            }}
          />
        ) : null}
        {actions.canRelease ? (
          <>
            <ActionDialog
              label="Hand off"
              icon={UsersRoundIcon}
              title={`Hand off ${ref}`}
              description="Give command to an actor that has used incidents before, by its key (for example claude-code:<session>)."
              submitLabel="Hand off command"
              noteLabel="Hand-off note"
              noteRequired={false}
              onSubmit={async (form) => {
                await run("handoff", {
                  actor,
                  ref,
                  expectedRevision: incident.revision,
                  to: required(form, "to"),
                  ...noteOf(form),
                });
                report({ tone: "ok", text: `Handed off ${ref}.` });
              }}
            >
              <HandoffTarget />
            </ActionDialog>
            <ActionDialog
              label="Release"
              icon={UserRoundXIcon}
              title={`Release ${ref}`}
              description="Release command so another agent or person can take it."
              submitLabel="Release command"
              noteLabel="Release note"
              noteRequired={false}
              onSubmit={async (form) => {
                await run("handoff", {
                  actor,
                  ref,
                  expectedRevision: incident.revision,
                  to: null,
                  ...noteOf(form),
                });
                report({ tone: "ok", text: `Released command of ${ref}.` });
              }}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

function noteOf(form: FormData): { note?: string } {
  const note = formText(form, "note");
  return note === undefined ? {} : { note };
}

function HandoffTarget(): React.JSX.Element {
  const id = useId();
  return (
    <div className="ui-field">
      <div className="ui-field-box">
        <label className="ui-field-label" htmlFor={id}>
          New commander key <span aria-hidden="true">*</span>
        </label>
        <input
          id={id}
          name="to"
          className="ui-field-control"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
