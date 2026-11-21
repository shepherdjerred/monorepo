import { useId, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDeploymentV2Request,
  ModelRoutes,
} from "#shared/model/routes-client.ts";
import type {
  EnvironmentSelection,
  RollbackCandidate,
} from "#shared/model/contract.ts";
import { DeliveryClientError } from "#shared/client.ts";
import { delivery } from "#client/api.ts";
import { queries } from "#client/queries.ts";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { Identifier, shortIdentifier } from "#client/components/identifier.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { MonitorPanel } from "./monitor-panel.tsx";
import {
  DeploymentLink,
  QueryPanel,
  SelectionFacts,
  SetRevision,
  SetRevisionLink,
  releaseName,
  type RevisionNumbers,
} from "./selection-facts.tsx";
import {
  groupCandidates,
  rebindChanges,
  splitCandidates,
  type CandidateGroup,
} from "./view.ts";
import type { Blocker } from "./environment-status.ts";
import { BlockedReason, RequestError } from "./environment-notices.tsx";
import { Fact, Facts } from "#client/components/facts.tsx";

type Requested = Awaited<ReturnType<ModelRoutes["createDeployment"]>>;
type Actions = {
  environmentId: string;
  permitted: boolean;
  /** The revision number of each set revision the page has loaded. */
  revisions: RevisionNumbers;
  /** What stops this environment from taking a request now. */
  blocker: Blocker | null;
  planWaiting: boolean;
  onDeployment: (deploymentId: string) => Promise<void>;
};

/**
 * Request a model deployment, then open it with every view refreshed. A
 * conflict refreshes the environment, so the page names what is in the way.
 */
function useRequest({ environmentId, onDeployment }: Actions) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeploymentV2Request) =>
      delivery.createDeployment(input),
    onSuccess: async (deployment: Requested) => {
      await queryClient.invalidateQueries();
      await onDeployment(deployment.id);
    },
    onError: async (error) => {
      if (error instanceof DeliveryClientError && error.code === "CONFLICT")
        await queryClient.invalidateQueries({
          queryKey: queries.environment(environmentId).queryKey,
        });
    },
  });
}

function approvalNote(view: EnvironmentSelection) {
  return view.approvalPolicy === "required"
    ? "The request waits for a human approval of its exact selection."
    : "The request starts once its gates pass.";
}

/** Why a rebind or rollback cannot be requested now, or null when it can. */
function refusal(
  view: EnvironmentSelection,
  { permitted, blocker, planWaiting }: Actions,
): ReactNode {
  if (!permitted) return "Your identity has read-only access.";
  if (view.lifecycle !== "active")
    return `A ${view.lifecycle} environment admits no deployments.`;
  return blocker === null ? null : (
    <BlockedReason blocker={blocker} planWaiting={planWaiting} />
  );
}

/** A request this panel sent, refused in words that name what is in the way. */
function Refused({ error, actions }: { error: unknown; actions: Actions }) {
  return (
    <RequestError
      error={error}
      blocker={actions.blocker}
      planWaiting={actions.planWaiting}
    />
  );
}

function SelectionPanel({
  view,
  ...actions
}: Actions & { view: EnvironmentSelection }) {
  const { environmentId, revisions } = actions;
  const changes = rebindChanges(view);
  const request = useRequest(actions);
  const refused = refusal(view, actions);
  const refusedId = useId();
  return (
    <>
      <Facts>
        <Fact label="Role">{view.role}</Fact>
        <Fact label="Lifecycle">{view.lifecycle}</Fact>
        <Fact label="Approval policy">
          {view.approvalPolicy === "required"
            ? "Human approval required"
            : "No approval"}
        </Fact>
        <Fact label="Binding generation">{view.bindingGeneration}</Fact>
      </Facts>
      <h3>Accepted selection</h3>
      {view.accepted === null || view.acceptedDeploymentId === null ? (
        <p className="empty">No selection has been accepted yet.</p>
      ) : (
        <>
          <SelectionFacts selection={view.accepted} revisions={revisions} />
          <p>
            Frozen by <DeploymentLink id={view.acceptedDeploymentId} short />
          </p>
        </>
      )}
      <h3>Declared binding</h3>
      <Facts>
        <Fact label="Recipe kind">{view.declared.recipeKind}</Fact>
        <Fact label="Recipe revision" mono>
          {view.declared.recipeRevisionId}
          {changes?.recipeRevisionId !== undefined && (
            <span className="differs"> · differs from accepted</span>
          )}
        </Fact>
        <Fact label="Configuration revision" mono>
          {view.declared.configurationRevisionId}
          {changes?.configurationRevisionId !== undefined && (
            <span className="differs"> · differs from accepted</span>
          )}
        </Fact>
      </Facts>
      {request.error !== null && (
        <Refused error={request.error} actions={actions} />
      )}
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
          disabled={changes === null || refused !== null}
          {...(refused === null ? {} : { describedBy: refusedId })}
          pending={request.isPending}
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
            Keeps set revision{" "}
            {view.accepted !== null && (
              <SetRevision
                id={view.accepted.versionSetRevisionId}
                revisions={revisions}
              />
            )}{" "}
            and moves to recipe {view.declared.recipeRevisionId} with
            configuration {view.declared.configurationRevisionId}.
          </p>
          <p>{approvalNote(view)}</p>
        </ConfirmButton>
      </div>
      {refused !== null && (
        <p className="notice" id={refusedId}>
          {refused}
        </p>
      )}
    </>
  );
}

/**
 * When and by which deployment a selection was accepted. A selection several
 * deployments accepted names the newest and lists every one behind a count.
 */
function CandidateOrigin({
  deployments,
}: {
  deployments: CandidateGroup<RollbackCandidate>["deployments"];
}) {
  const [newest] = deployments;
  if (deployments.length === 1)
    return (
      <p className="candidate-origin">
        Accepted <RelativeTime value={newest.acceptedAt} /> by deployment{" "}
        <DeploymentLink id={newest.deploymentId} short />
      </p>
    );
  return (
    <div className="candidate-origin">
      <Disclosure
        summary={
          <>
            Accepted {deployments.length} times, last{" "}
            <RelativeTime value={newest.acceptedAt} />
          </>
        }
      >
        <ul className="candidate-deployments">
          {deployments.map((entry) => (
            <li key={entry.deploymentId}>
              <RelativeTime value={entry.acceptedAt} clock /> by deployment{" "}
              <DeploymentLink id={entry.deploymentId} short />
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

function Candidate({
  group,
  view,
  environmentId,
  revisions,
  refusedId,
  pending,
  onRollback,
}: {
  group: CandidateGroup<RollbackCandidate>;
  view: EnvironmentSelection | undefined;
  environmentId: string;
  revisions: RevisionNumbers;
  /** The id of the reason no rollback can be requested now, or null when one can. */
  refusedId: string | null;
  pending: boolean;
  onRollback: (deploymentId: string) => void;
}) {
  const label = useId();
  const reason = useId();
  const { candidate } = group;
  const { selection } = candidate;
  // The accepted selection is itself a source: restoring it re-asserts its
  // frozen inputs after a failed or drifted target.
  const current = candidate.deploymentId === view?.acceptedDeploymentId;
  const action = current ? "Re-assert this selection" : "Roll back to this";
  // Every candidate's button reads the same, so its name says which it is.
  const name = `${action}: ${releaseName(selection.versionSetRevisionId, revisions)}, deployment ${shortIdentifier(candidate.deploymentId)}`;
  return (
    <li className={candidate.eligible ? undefined : "candidate-excluded"}>
      <div className="candidate-heading">
        <div className="candidate-identity" id={label}>
          <p className="candidate-selection">
            <strong>
              <SetRevisionLink
                id={selection.versionSetRevisionId}
                revisions={revisions}
              />
            </strong>{" "}
            · recipe <span className="mono">{selection.recipeRevisionId}</span>{" "}
            · configuration{" "}
            <span className="mono">{selection.configurationRevisionId}</span>
            {current && (
              <span className="badge badge-current">Accepted now</span>
            )}
          </p>
          <CandidateOrigin deployments={group.deployments} />
        </div>
        {candidate.eligible ? (
          <ConfirmButton
            label={action}
            name={name}
            title={`Roll back ${environmentId}?`}
            confirmLabel="Request rollback"
            describedBy={refusedId === null ? label : `${label} ${refusedId}`}
            disabled={refusedId !== null}
            pending={pending}
            onConfirm={() => {
              onRollback(candidate.deploymentId);
            }}
          >
            <p>
              {current ? "Re-asserts" : "Restores"} the selection accepted by
              deployment <Identifier value={candidate.deploymentId} />: set
              revision{" "}
              <SetRevision
                id={selection.versionSetRevisionId}
                revisions={revisions}
              />
              , recipe {selection.recipeRevisionId}, configuration{" "}
              {selection.configurationRevisionId}.
            </p>
            {view !== undefined && <p>{approvalNote(view)}</p>}
            <p>Data restoration remains a separate recovery operation.</p>
          </ConfirmButton>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled
            aria-label={name}
            aria-describedby={`${label} ${reason}`}
          >
            {action}
          </button>
        )}
      </div>
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
  ...actions
}: Actions & {
  candidates: RollbackCandidate[];
  view: EnvironmentSelection | undefined;
}) {
  const { environmentId, revisions } = actions;
  const request = useRequest(actions);
  const refusedId = useId();
  if (candidates.length === 0)
    return (
      <p className="empty">No previously accepted selection to restore.</p>
    );
  const refused =
    view === undefined
      ? "The binding generation is unavailable, so a rollback cannot be requested."
      : refusal(view, actions);
  const { shown, older } = splitCandidates(
    groupCandidates(candidates, view?.acceptedDeploymentId),
    view?.acceptedDeploymentId,
  );
  const list = (items: CandidateGroup<RollbackCandidate>[], start: number) => (
    <ol className="candidates" start={start}>
      {items.map((group) => (
        <Candidate
          key={group.deploymentId}
          group={group}
          view={view}
          environmentId={environmentId}
          revisions={revisions}
          refusedId={refused === null ? null : refusedId}
          pending={request.isPending}
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
  );
  return (
    <>
      <p className="muted">
        Accepted selections, newest first. Restoring the accepted one re-asserts
        its frozen inputs after a failed or drifted target. A selection is
        excluded when restoring it would lower a forward-only configuration key
        or cross a point-of-no-return step.
      </p>
      {refused !== null && (
        <p className="notice" id={refusedId}>
          {refused}
        </p>
      )}
      {request.error !== null && (
        <Refused error={request.error} actions={actions} />
      )}
      {list(shown, 1)}
      {older.length > 0 && (
        <Disclosure summary="Older candidates" count={older.length}>
          {list(older, shown.length + 1)}
        </Disclosure>
      )}
    </>
  );
}

/**
 * The environment's model state: the accepted selection beside the declared
 * binding, the accepted deployment's monitor, and its rollback candidates.
 */
export function EnvironmentModel(actions: Actions) {
  const selection = useQuery(queries.selection(actions.environmentId));
  const monitor = useQuery(queries.monitor(actions.environmentId));
  const candidates = useQuery(
    queries.rollbackCandidates(actions.environmentId),
  );
  return (
    <>
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
