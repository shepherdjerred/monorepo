import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeliveryClient } from "#shared/client.ts";
import type {
  Deployment,
  Environment,
  WorkerPoolSnapshot,
  WorkerVersion,
} from "#shared/contract.ts";
import { ErrorNotice } from "./components.tsx";

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

export function WorkerPoolPanel({
  client,
  environment,
  deployments,
  permitted,
  onDeployment,
}: {
  client: DeliveryClient;
  environment: Environment;
  deployments: Deployment[];
  permitted: boolean;
  onDeployment: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmedWorker, setConfirmedWorker] = useState<string | null>(null);
  const pool = useQuery({
    queryKey: ["workers", environment.id],
    queryFn: () => client.workers(environment.id),
  });
  const retirement = useMutation({
    mutationFn: (worker: WorkerVersion) => {
      if (pool.data === undefined) throw new Error("Worker pool unavailable");
      return client.retireWorker(worker.id, {
        requestId: crypto.randomUUID(),
        expectedEnvironmentGeneration: pool.data.generation,
        expectedWorkerGeneration: worker.generation,
      });
    },
    onSuccess: async (deployment) => {
      await queryClient.invalidateQueries();
      onDeployment(deployment.id);
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
  return (
    <section className="panel" aria-label="Retained workers">
      <h2>Retained workers</h2>
      <p>
        Desired host counts preserve older executions. Retirement requests do
        not stop a host until the executor verifies every route and accepts the
        deployment.
      </p>
      {selected === undefined && (
        <p className="notice">
          Retirement becomes available after acceptance records a frozen worker
          pool.
        </p>
      )}
      {retirement.error !== null && <ErrorNotice error={retirement.error} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Original artifact and fixed host</th>
              <th>Desired hosts</th>
              <th>Retirement</th>
            </tr>
          </thead>
          <tbody>
            {pool.data.versions.map((worker) => (
              <tr key={worker.id}>
                <td>
                  <WorkerIdentity worker={worker} />
                </td>
                <td>
                  {worker.replicas === 0
                    ? "Zero · artifact retained"
                    : worker.buildId === selected
                      ? "1 · selected"
                      : "1 · retained"}
                </td>
                <td>
                  {worker.replicas === 1 &&
                    selected !== undefined &&
                    worker.buildId !== selected &&
                    permitted && (
                      <>
                        {confirmedWorker === worker.id ? (
                          <div>
                            <p>
                              Request retirement of build{" "}
                              {worker.buildId.slice(0, 12)}?
                            </p>
                            <button
                              className="secondary-button danger"
                              disabled={busy || retirement.isPending}
                              onClick={() => {
                                retirement.mutate(worker);
                              }}
                            >
                              Confirm retirement request
                            </button>
                            <button
                              className="text-button"
                              onClick={() => {
                                setConfirmedWorker(null);
                              }}
                            >
                              Keep host
                            </button>
                          </div>
                        ) : (
                          <button
                            className="secondary-button"
                            disabled={busy || retirement.isPending}
                            onClick={() => {
                              setConfirmedWorker(worker.id);
                            }}
                          >
                            Request retirement
                          </button>
                        )}
                      </>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
