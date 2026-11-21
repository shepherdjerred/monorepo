import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { delivery } from "./api.ts";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { Fact, Facts } from "#client/components/facts.tsx";
import { Identifier } from "#client/components/identifier.tsx";
import type {
  Deployment,
  Environment,
  WorkerPoolSnapshot,
  WorkerVersion,
} from "#shared/contract.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { DeploymentLink } from "#client/model/selection-facts.tsx";

function WorkerIdentity({ worker }: { worker: WorkerVersion }) {
  return (
    <>
      <strong className="mono">{worker.buildId}</strong>
      <small className="mono">{worker.image}</small>
      <small>
        Artifact {worker.artifactId} · build {worker.artifactBuildId}
      </small>
      <small>Introduced by {worker.introducedByDeploymentId}</small>
      <small>
        {worker.host.kubernetesNamespace} · {worker.host.profile}
      </small>
      {worker.host.routes.map((route) => (
        <small key={route.namespace}>
          {route.namespace} / {route.deploymentName} / {route.taskQueue}
        </small>
      ))}
    </>
  );
}

export function FrozenWorkerPool({
  snapshot,
  kind,
}: {
  snapshot: WorkerPoolSnapshot;
  kind: Deployment["kind"];
}) {
  return (
    <section aria-label="Frozen worker pool">
      <h3>Frozen worker pool</h3>
      {snapshot.workerOperation === "baseline" && (
        <p className="notice">
          Host-only baseline adoption independently verifies existing workers.
          It does not accept or change the full application release.
        </p>
      )}
      <p>
        Selected build{" "}
        <strong className="mono">{snapshot.candidateBuildId}</strong>
      </p>
      {kind === "rollback" && snapshot.restoredFromDeploymentId !== null && (
        <p>
          Restores target from {snapshot.restoredFromDeploymentId}; newer live
          hosts remain retained.
        </p>
      )}
      {snapshot.workerOperation === "retire" && (
        <p className="notice">
          Retirement requested for {snapshot.retiringWorkerId}. Scale to zero
          requires fresh routing and drain proof during execution.
        </p>
      )}
      <p className="muted">
        These exact desired hosts are bound to this deployment and its approval.
        Runtime acceptance is recorded separately.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Original artifact and fixed host</th>
              <th>Desired hosts</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.versions.map((worker) => (
              <tr key={worker.id}>
                <td>
                  <WorkerIdentity worker={worker} />
                </td>
                <td>
                  {worker.replicas === 0
                    ? "Zero · artifact retained"
                    : worker.buildId === snapshot.candidateBuildId
                      ? "1 · selected"
                      : "1 · retained"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Where a worker host runs, in one line: its profile, then each Temporal namespace and task queue it serves. */
function hostSummary(host: WorkerVersion["host"]) {
  return [
    host.profile,
    host.routes
      .map((route) => `${route.namespace} / ${route.taskQueue}`)
      .join(", "),
  ].join(" · ");
}

/**
 * One worker build as a compact row: its build and digest in short form, its
 * host in one line, and behind that line every identity the row abbreviates.
 */
function WorkerSummary({ worker, id }: { worker: WorkerVersion; id: string }) {
  return (
    <>
      <span className="worker-build" id={id}>
        <strong>
          <Identifier value={worker.buildId} />
        </strong>
        <Identifier value={worker.digest} />
      </span>
      <Disclosure summary={hostSummary(worker.host)}>
        <div className="worker-provenance">
          <Facts>
            <Fact label="Build" mono>
              {worker.buildId}
            </Fact>
            <Fact label="Image" mono>
              {worker.image}
            </Fact>
            <Fact label="Artifact" mono>
              {worker.artifactId} · build {worker.artifactBuildId}
            </Fact>
            <Fact label="Introduced by">
              <DeploymentLink id={worker.introducedByDeploymentId} />
            </Fact>
            <Fact label="Host">
              {worker.host.kubernetesNamespace} · {worker.host.profile}
            </Fact>
            <Fact label="Routes">
              {worker.host.routes.map((route) => (
                <span key={route.namespace} className="worker-route">
                  {route.namespace} / {route.deploymentName} / {route.taskQueue}
                </span>
              ))}
            </Fact>
          </Facts>
        </div>
      </Disclosure>
    </>
  );
}

function desiredHosts(worker: WorkerVersion, selected: string | undefined) {
  if (worker.replicas === 0) return "Zero · artifact retained";
  return worker.buildId === selected ? "1 · selected" : "1 · retained";
}

function WorkerRow({
  worker,
  selected,
  retire,
}: {
  worker: WorkerVersion;
  selected: string | undefined;
  /**
   * The retirement this row offers; null where its build cannot be retired
   * now, and undefined in a table with no retirement column.
   */
  retire:
    | { disabled: boolean; pending: boolean; request: () => void }
    | null
    | undefined;
}) {
  const build = useId();
  return (
    <tr>
      <td>
        <WorkerSummary worker={worker} id={build} />
      </td>
      <td>{desiredHosts(worker, selected)}</td>
      {retire !== undefined && (
        <td>
          {retire !== null && (
            <ConfirmButton
              label="Request retirement"
              title={`Retire build ${worker.buildId.slice(0, 12)}?`}
              confirmLabel="Confirm retirement request"
              danger
              describedBy={build}
              disabled={retire.disabled}
              pending={retire.pending}
              onConfirm={retire.request}
            >
              <p>
                The host keeps running until the executor verifies every route
                has drained.
              </p>
            </ConfirmButton>
          )}
        </td>
      )}
    </tr>
  );
}

export function WorkerPoolPanel({
  environment,
  deployments,
  permitted,
  onDeployment,
}: {
  environment: Environment;
  deployments: Deployment[];
  permitted: boolean;
  onDeployment: (id: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const pool = useQuery({
    queryKey: ["workers", environment.id],
    queryFn: () => delivery.workers(environment.id),
  });
  const retirement = useMutation({
    mutationFn: (worker: WorkerVersion) => {
      if (pool.data === undefined) throw new Error("Worker pool unavailable");
      return delivery.retireWorker(worker.id, {
        requestId: crypto.randomUUID(),
        expectedEnvironmentGeneration: pool.data.generation,
        expectedWorkerGeneration: worker.generation,
      });
    },
    onSuccess: async (deployment) => {
      await queryClient.invalidateQueries();
      await onDeployment(deployment.id);
    },
  });
  const accepted = deployments.find(
    (deployment) =>
      deployment.environmentId === environment.id &&
      deployment.status === "succeeded" &&
      deployment.kind !== "adopt-worker" &&
      deployment.versionSetRevisionId ===
        environment.acceptedVersionSetRevisionId,
  );
  const selected = accepted?.workerSnapshot?.candidateBuildId;
  const busy = deployments.some(
    (deployment) =>
      deployment.environmentId === environment.id &&
      ["running", "queued", "awaiting_approval"].includes(deployment.status),
  );
  if (pool.isPending) return <p role="status">Loading retained workers…</p>;
  if (pool.error !== null) return <ErrorNotice error={pool.error} />;
  if (pool.data.versions.length === 0) return null;
  // A build with a desired host is running. One without is only a retained
  // artifact, so it is listed out of the way.
  const hosted = pool.data.versions.filter((worker) => worker.replicas === 1);
  const unhosted = pool.data.versions.filter((worker) => worker.replicas === 0);
  return (
    <section className="panel" aria-label="Retained workers">
      <h2>Retained workers</h2>
      <p>
        Desired host counts preserve older executions. Retirement requests do
        not stop a host until the executor verifies every route and accepts the
        deployment.
      </p>
      {selected === undefined && (
        <p className="notice info">
          Retirement becomes available after acceptance records a frozen worker
          pool.
        </p>
      )}
      {retirement.error !== null && <ErrorNotice error={retirement.error} />}
      {hosted.length === 0 ? (
        <p className="empty">No worker build has a desired host.</p>
      ) : (
        <div className="table-scroll">
          <table className="worker-table">
            <thead>
              <tr>
                <th>Original artifact and fixed host</th>
                <th>Desired hosts</th>
                <th>Retirement</th>
              </tr>
            </thead>
            <tbody>
              {hosted.map((worker) => (
                <WorkerRow
                  key={worker.id}
                  worker={worker}
                  selected={selected}
                  retire={
                    permitted &&
                    selected !== undefined &&
                    worker.buildId !== selected
                      ? {
                          disabled: busy,
                          pending: retirement.isPending,
                          request: () => {
                            retirement.mutate(worker);
                          },
                        }
                      : null
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unhosted.length > 0 && (
        <Disclosure
          summary="Retained artifacts with no desired host"
          count={unhosted.length}
        >
          <div className="table-scroll">
            <table className="worker-table">
              <thead>
                <tr>
                  <th>Original artifact and fixed host</th>
                  <th>Desired hosts</th>
                </tr>
              </thead>
              <tbody>
                {unhosted.map((worker) => (
                  <WorkerRow
                    key={worker.id}
                    worker={worker}
                    selected={selected}
                    retire={undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
    </section>
  );
}
