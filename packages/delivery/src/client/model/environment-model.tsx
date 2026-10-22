import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDeploymentV2Request,
  ModelRoutes,
} from "#shared/model/routes-client.ts";
import type {
  EnvironmentSelection,
  RollbackCandidate,
} from "#shared/model/contract.ts";
import type { EnvironmentDetail } from "#shared/hub/hub-contract.ts";
import { delivery } from "#client/api.ts";
import { queries } from "#client/queries.ts";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { ErrorNotice } from "#client/components/notices.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { MonitorPanel } from "./monitor-panel.tsx";
import {
  DeploymentLink,
  QueryPanel,
  SelectionFacts,
} from "./selection-facts.tsx";
import { rebindChanges } from "./view.ts";

type Requested = Awaited<ReturnType<ModelRoutes["createDeployment"]>>;
type Actions = {
  environmentId: string;
  permitted: boolean;
  onDeployment: (deploymentId: string) => Promise<void>;
};

/** Request a model deployment, then open it with every view refreshed. */
function useRequest(onDeployment: Actions["onDeployment"]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeploymentV2Request) =>
      delivery.createDeployment(input),
    onSuccess: async (deployment: Requested) => {
      await queryClient.invalidateQueries();
      await onDeployment(deployment.id);
    },
  });
}

function approvalNote(view: EnvironmentSelection) {
  return view.approvalPolicy === "required"
    ? "The request waits for a human approval of its exact selection."
    : "The request starts once its gates pass.";
}

function refusal(view: EnvironmentSelection, permitted: boolean) {
  if (!permitted) return "Your identity has read-only access.";
  return view.lifecycle === "active"
    ? null
    : `A ${view.lifecycle} environment admits no deployments.`;
}

function SelectionPanel({
  view,
  environmentId,
  permitted,
  onDeployment,
}: Actions & { view: EnvironmentSelection }) {
  const changes = rebindChanges(view);
  const request = useRequest(onDeployment);
  const refused = refusal(view, permitted);
  return (
    <>
      <dl className="facts">
        <div>
          <dt>Role</dt>
          <dd>{view.role}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{view.lifecycle}</dd>
        </div>
        <div>
          <dt>Approval policy</dt>
          <dd>
            {view.approvalPolicy === "required"
              ? "Human approval required"
              : "No approval"}
          </dd>
        </div>
        <div>
          <dt>Binding generation</dt>
          <dd>{view.bindingGeneration}</dd>
        </div>
      </dl>
      <h3>Accepted selection</h3>
      {view.accepted === null || view.acceptedDeploymentId === null ? (
        <p className="empty">No selection has been accepted yet.</p>
      ) : (
        <>
          <SelectionFacts selection={view.accepted} />
          <p>
            Frozen by <DeploymentLink id={view.acceptedDeploymentId} />
          </p>
        </>
      )}
      <h3>Declared binding</h3>
      <dl className="facts">
        <div>
          <dt>Recipe kind</dt>
          <dd>{view.declared.recipeKind}</dd>
        </div>
        <div>
          <dt>Recipe revision</dt>
          <dd className="mono">
            {view.declared.recipeRevisionId}
            {changes?.recipeRevisionId !== undefined && (
              <span className="differs"> · differs from accepted</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Configuration revision</dt>
          <dd className="mono">
            {view.declared.configurationRevisionId}
            {changes?.configurationRevisionId !== undefined && (
              <span className="differs"> · differs from accepted</span>
            )}
          </dd>
        </div>
      </dl>
      {request.error !== null && <ErrorNotice error={request.error} />}
      <div className="form-footer">
        <p>
          {changes === null
            ? view.accepted === null
              ? "A rebind keeps an accepted set revision; none is accepted yet."
              : "The accepted selection already uses the declared binding."
            : "A rebind keeps the accepted set revision and moves to the declared recipe and configuration."}
        </p>
        <ConfirmButton
          label="Rebind"
          title={`Rebind ${environmentId}?`}
          confirmLabel="Request rebind"
          disabled={changes === null || refused !== null || request.isPending}
          onConfirm={() => {
            if (changes === null) return;
            request.mutate({
              requestId: crypto.randomUUID(),
              environmentId,
              expectedGeneration: view.bindingGeneration,
              kind: "rebind",
              ...changes,
            });
          }}
        >
          <p>
            Keeps set revision {view.accepted?.versionSetRevisionId} and moves
            to recipe {view.declared.recipeRevisionId} with configuration{" "}
            {view.declared.configurationRevisionId}.
          </p>
          <p>{approvalNote(view)}</p>
        </ConfirmButton>
      </div>
      {refused !== null && <p className="notice">{refused}</p>}
    </>
  );
}

function Candidate({
  candidate,
  view,
  environmentId,
  disabled,
  onRollback,
}: {
  candidate: RollbackCandidate;
  view: EnvironmentSelection | undefined;
  environmentId: string;
  disabled: boolean;
  onRollback: (deploymentId: string) => void;
}) {
  const label = useId();
  const reason = useId();
  // The accepted selection is itself a source: restoring it re-asserts its
  // frozen inputs after a failed or drifted target.
  const current = candidate.deploymentId === view?.acceptedDeploymentId;
  const action = current ? "Re-assert this selection" : "Roll back to this";
  return (
    <li className={candidate.eligible ? undefined : "candidate-excluded"}>
      <div className="candidate-heading">
        <span id={label}>
          <DeploymentLink id={candidate.deploymentId} /> · accepted{" "}
          <RelativeTime value={candidate.acceptedAt} />
          {current && <span className="badge badge-current">Accepted now</span>}
        </span>
        {candidate.eligible ? (
          <ConfirmButton
            label={action}
            title={`Roll back ${environmentId}?`}
            confirmLabel="Request rollback"
            describedBy={label}
            disabled={disabled}
            onConfirm={() => {
              onRollback(candidate.deploymentId);
            }}
          >
            <p>
              {current ? "Re-asserts" : "Restores"} the selection accepted by{" "}
              {candidate.deploymentId}: set revision{" "}
              {candidate.selection.versionSetRevisionId}, recipe{" "}
              {candidate.selection.recipeRevisionId}, configuration{" "}
              {candidate.selection.configurationRevisionId}.
            </p>
            {view !== undefined && <p>{approvalNote(view)}</p>}
            <p>Data restoration remains a separate recovery operation.</p>
          </ConfirmButton>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled
            aria-describedby={`${label} ${reason}`}
          >
            {action}
          </button>
        )}
      </div>
      <SelectionFacts selection={candidate.selection} />
      {!candidate.eligible && (
        <p className="candidate-reason" id={reason}>
          <strong>Not eligible:</strong> {candidate.reason}
        </p>
      )}
    </li>
  );
}

function RollbackCandidates({
  candidates,
  view,
  environmentId,
  permitted,
  onDeployment,
}: Actions & {
  candidates: RollbackCandidate[];
  view: EnvironmentSelection | undefined;
}) {
  const request = useRequest(onDeployment);
  if (candidates.length === 0)
    return (
      <p className="empty">No previously accepted selection to restore.</p>
    );
  const refused =
    view === undefined
      ? "The binding generation is unavailable, so a rollback cannot be requested."
      : refusal(view, permitted);
  return (
    <>
      <p className="muted">
        Accepted selections, newest first. Restoring the accepted one re-asserts
        its frozen inputs after a failed or drifted target. A selection is
        excluded when restoring it would lower a forward-only configuration key
        or cross a point-of-no-return step.
      </p>
      {request.error !== null && <ErrorNotice error={request.error} />}
      <ol className="candidates">
        {candidates.map((candidate) => (
          <Candidate
            key={candidate.deploymentId}
            candidate={candidate}
            view={view}
            environmentId={environmentId}
            disabled={refused !== null || request.isPending}
            onRollback={(selectionDeploymentId) => {
              if (view === undefined) return;
              request.mutate({
                requestId: crypto.randomUUID(),
                environmentId,
                expectedGeneration: view.bindingGeneration,
                kind: "rollback",
                selectionDeploymentId,
              });
            }}
          />
        ))}
      </ol>
      {refused !== null && <p className="notice">{refused}</p>}
    </>
  );
}

/**
 * A reconcile-after-restore mismatch: automatic deployments stay held until an
 * administrator accepts the live state with evidence or an operator rolls back.
 */
function RestoreHold({
  hold,
  environmentId,
}: {
  hold: NonNullable<EnvironmentDetail["restoreHold"]>;
  environmentId: string;
}) {
  return (
    <section
      className="panel panel-attention"
      aria-labelledby="restore-hold-heading"
    >
      <h2 id="restore-hold-heading">Held after restore</h2>
      <p className="notice error">{hold.reason}</p>
      <dl className="facts">
        <div>
          <dt>Held</dt>
          <dd>
            <RelativeTime value={hold.heldAt} />
          </dd>
        </div>
        <div>
          <dt>Snapshot catalog revision</dt>
          <dd className="mono">{hold.catalogRevision}</dd>
        </div>
      </dl>
      <p>
        Automatic deployments wait until the record, the cold-start snapshot and
        the live target agree. Roll back to a candidate below, or an
        administrator accepts the live state with evidence:
      </p>
      <pre className="command">
        <code>
          toolkit deploy snapshot accept {environmentId} --reason &quot;…&quot;
          --evidence &quot;…&quot; --machine
        </code>
      </pre>
    </section>
  );
}

/**
 * The environment's model state: any restore hold, the accepted selection
 * beside the declared binding, the accepted deployment's monitor, and its
 * rollback candidates.
 */
export function EnvironmentModel({
  restoreHold,
  ...actions
}: Actions & { restoreHold: EnvironmentDetail["restoreHold"] }) {
  const selection = useQuery(queries.selection(actions.environmentId));
  const monitor = useQuery(queries.monitor(actions.environmentId));
  const candidates = useQuery(
    queries.rollbackCandidates(actions.environmentId),
  );
  return (
    <>
      {restoreHold !== null && (
        <RestoreHold hold={restoreHold} environmentId={actions.environmentId} />
      )}
      <div className="detail-grid">
        <QueryPanel id="selection" title="Selection" query={selection}>
          {(view) => <SelectionPanel view={view} {...actions} />}
        </QueryPanel>
        <QueryPanel id="monitor" title="Monitor" query={monitor}>
          {(status) => <MonitorPanel status={status} />}
        </QueryPanel>
      </div>
      <QueryPanel id="rollback" title="Rollback candidates" query={candidates}>
        {(data) => (
          <RollbackCandidates
            candidates={data.candidates}
            view={selection.data}
            {...actions}
          />
        )}
      </QueryPanel>
    </>
  );
}
