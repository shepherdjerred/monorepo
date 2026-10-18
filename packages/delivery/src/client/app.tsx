import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDeliveryClient } from "#shared/client.ts";
import type { CreateDeployment, Environment } from "#shared/contract.ts";
import { DeploymentList, EnvironmentCard, ErrorNotice } from "./components.tsx";
import { ReleaseForm } from "./release-form.tsx";
import {
  DeploymentDetail,
  type DeploymentAction,
} from "./deployment-detail.tsx";
import { canDeploy } from "./presentation.ts";
import { BuildCatalog } from "./artifacts.tsx";
import { WorkerPoolPanel } from "./worker-pool.tsx";
import { PlatformReleaseForm } from "./platform-release-form.tsx";
import { ForumBaselinePanel } from "./forum-baseline.tsx";

const client = createDeliveryClient({ baseUrl: globalThis.location.origin });
type Page = "environments" | "deployments" | "versions" | "approvals";
const PAGE_DETAILS: Record<Page, { title: string; subtitle: string }> = {
  environments: {
    title: "Environments",
    subtitle: "Every release, from selection to acceptance.",
  },
  deployments: {
    title: "Deployments",
    subtitle: "Follow each deployment through its pipeline.",
  },
  approvals: {
    title: "Approval queue",
    subtitle: "Review the exact release before it reaches production.",
  },
  versions: {
    title: "Version catalog",
    subtitle: "Immutable artifacts and the versions they compose.",
  },
};

function useDeliveryState() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState<Page>("environments");
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const identity = useQuery({
    queryKey: ["identity"],
    queryFn: () => client.identity(),
  });
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () => client.overview(),
  });
  const detail = useQuery({
    queryKey: ["deployment", deploymentId],
    queryFn: () => {
      if (deploymentId === null) throw new Error("Select a deployment");
      return client.deployment(deploymentId);
    },
    enabled: deploymentId !== null,
  });
  const request = useMutation({
    mutationFn: (input: CreateDeployment) => client.createDeployment(input),
    onSuccess: async (deployment) => {
      setEnvironmentId(null);
      setDeploymentId(deployment.id);
      await queryClient.invalidateQueries();
    },
  });
  const action = useMutation({
    mutationFn: async (input: DeploymentAction) => {
      if (detail.data === undefined)
        throw new Error("Deployment details unavailable");
      const id = detail.data.deployment.id;
      switch (input.kind) {
        case "recovery-decision":
          await client.approvePlatformRecoveryPlan(input.intentId, {
            planFingerprint: input.planFingerprint,
            decision: input.decision,
            reason: input.reason,
          });
          return detail.data.deployment;
        case "approve":
        case "reject":
          return client.approve(id, {
            decision: input.kind,
            reason: input.reason,
          });
        case "cancel":
          return client.cancel(id);
        case "retry":
          return client.retry(id, {
            requestId: crypto.randomUUID(),
            expectedGeneration: detail.data.environment.generation,
          });
      }
    },
    onSuccess: async (deployment) => {
      setDeploymentId(deployment.id);
      await queryClient.invalidateQueries();
    },
  });
  const data = overview.data;
  const approvals =
    data?.deployments.filter(
      (deployment) => deployment.status === "awaiting_approval",
    ) ?? [];
  const environment = data?.environments.find(
    (candidate) => candidate.id === environmentId,
  );
  function selectEnvironment(value: Environment) {
    setEnvironmentId(value.id);
    setDeploymentId(null);
    request.reset();
    action.reset();
  }
  function selectDeployment(id: string) {
    setDeploymentId(id);
    setEnvironmentId(null);
    request.reset();
    action.reset();
  }
  function navigate(value: Page) {
    setPage(value);
    setEnvironmentId(null);
    setDeploymentId(null);
  }
  return {
    queryClient,
    page,
    identity,
    overview,
    detail,
    request,
    action,
    data,
    approvals,
    environment,
    deploymentId,
    setEnvironmentId,
    setDeploymentId,
    selectEnvironment,
    selectDeployment,
    navigate,
  };
}

export function App() {
  const state = useDeliveryState();
  const {
    queryClient,
    page,
    identity,
    overview,
    request,
    action,
    data,
    approvals,
    selectEnvironment,
    selectDeployment,
    navigate,
  } = state;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Delivery home">
          <span className="brand-symbol" aria-hidden="true">
            ↗
          </span>
          Delivery<span className="brand-period">.</span>
        </a>
        <p className="sidebar-caption">Release control</p>
        <nav aria-label="Main navigation">
          {(
            [
              ["environments", "Environments", "◫"],
              ["deployments", "Deployments", "↗"],
              ["versions", "Version catalog", "▤"],
              ["approvals", "Approvals", "✓"],
            ] satisfies [Page, string, string][]
          ).map(([id, label, icon]) => (
            <button
              key={id}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                navigate(id);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {id === "approvals" && approvals.length > 0 && (
                <span className="nav-count">{approvals.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="dot" />
          Homelab<p>{identity.data?.id ?? "Checking identity…"}</p>
          <small>{identity.data?.kind ?? "Authentication required"}</small>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">Homelab / Delivery</p>
            <h1>{PAGE_DETAILS[page].title}</h1>
            <p className="subtitle">{PAGE_DETAILS[page].subtitle}</p>
          </div>
          <button
            className="secondary-button"
            disabled={overview.isFetching}
            onClick={() => {
              void queryClient.invalidateQueries();
            }}
          >
            {overview.isFetching ? "Refreshing…" : "↻ Refresh"}
          </button>
        </header>
        {identity.error !== null && <ErrorNotice error={identity.error} />}
        {overview.error !== null && <ErrorNotice error={overview.error} />}
        {request.error !== null && <ErrorNotice error={request.error} />}
        {action.error !== null && <ErrorNotice error={action.error} />}
        {overview.isPending && (
          <p role="status" className="empty">
            Loading release state…
          </p>
        )}
        {data !== undefined && (
          <>
            <div className="stats">
              <div>
                <span>Environments</span>
                <strong>{data.environments.length}</strong>
              </div>
              <div>
                <span>In progress</span>
                <strong>
                  {
                    data.deployments.filter((deployment) =>
                      ["running", "queued"].includes(deployment.status),
                    ).length
                  }
                </strong>
              </div>
              <div>
                <span>Awaiting approval</span>
                <strong>{approvals.length}</strong>
              </div>
              <div>
                <span>Version sets</span>
                <strong>{data.versionSets.length}</strong>
              </div>
            </div>
            <SelectedPanels state={state} />
            {page === "environments" && (
              <>
                <div className="section-heading">
                  <h2>Release destinations</h2>
                  <span className="muted">Desired · observed · accepted</span>
                </div>
                {data.environments.length === 0 ? (
                  <p className="empty">
                    No environments registered. Register a reviewed pipeline and
                    environment to begin.
                  </p>
                ) : (
                  <div className="environment-grid">
                    {data.environments.map((item) => (
                      <EnvironmentCard
                        key={item.id}
                        environment={item}
                        overview={data}
                        onSelect={selectEnvironment}
                        onDeployment={selectDeployment}
                      />
                    ))}
                  </div>
                )}
                <section className="panel">
                  <div className="section-heading">
                    <h2>Recent deployments</h2>
                    <button
                      className="text-button"
                      onClick={() => {
                        navigate("deployments");
                      }}
                    >
                      View all →
                    </button>
                  </div>
                  <DeploymentList
                    deployments={data.deployments.slice(0, 5)}
                    onSelect={selectDeployment}
                  />
                </section>
              </>
            )}
            {(page === "deployments" || page === "approvals") && (
              <section className="panel">
                <DeploymentList
                  deployments={
                    page === "approvals" ? approvals : data.deployments
                  }
                  onSelect={selectDeployment}
                />
              </section>
            )}
            {page === "versions" && (
              <>
                <BuildCatalog builds={data.builds} />
                <section className="panel">
                  <div className="section-heading">
                    <h2>Version set revisions</h2>
                    <span className="muted">Exact component selections</span>
                  </div>
                  {data.versionSets.length === 0 ? (
                    <p className="empty">No version sets published.</p>
                  ) : (
                    <div className="version-list">
                      {data.versionSets.map((version) => (
                        <details key={version.id}>
                          <summary>
                            <strong>
                              {version.serviceId} @ {version.revision}
                            </strong>
                            <span className="mono muted">{version.id}</span>
                          </summary>
                          <dl className="component-list">
                            {Object.entries(version.components).map(
                              ([name, artifact]) => (
                                <div key={name}>
                                  <dt>{name}</dt>
                                  <dd>
                                    {artifact.version}
                                    <small className="mono">
                                      {artifact.digest}
                                    </small>
                                    <small>
                                      Source {artifact.sourceRevision}
                                    </small>
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                        </details>
                      ))}
                    </div>
                  )}
                </section>
                <section className="panel">
                  <h2>Published artifacts</h2>
                  {data.artifacts.length === 0 ? (
                    <p className="empty">
                      No verified builds have published artifacts.
                    </p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Component</th>
                            <th>Version</th>
                            <th>Kind</th>
                            <th>Source / build</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.artifacts.map((artifact) => (
                            <tr key={artifact.id}>
                              <td>
                                <strong>{artifact.component}</strong>
                                <small>{artifact.serviceId}</small>
                              </td>
                              <td className="mono">
                                {artifact.version}
                                <small>{artifact.digest}</small>
                              </td>
                              <td>
                                {artifact.kind}
                                <small>{artifact.origin.kind}</small>
                                {artifact.origin.kind === "licensed-bundle" && (
                                  <small>
                                    Licensed XenForo{" "}
                                    {artifact.origin.xenforoVersion}
                                  </small>
                                )}
                              </td>
                              <td className="mono">
                                {artifact.sourceRevision.slice(0, 12)}
                                <small>{artifact.buildId}</small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
        <footer className="page-footer">
          Desired state is a selection. Acceptance requires verified runtime
          evidence.
        </footer>
      </main>
    </div>
  );
}

function SelectedPanels({
  state,
}: {
  state: ReturnType<typeof useDeliveryState>;
}) {
  const {
    data,
    identity,
    environment,
    request,
    setEnvironmentId,
    deploymentId,
    detail,
    action,
    setDeploymentId,
  } = state;
  if (data === undefined || identity.data === undefined) return null;
  return (
    <>
      {environment !== undefined && (
        <>
          {environment.id === "gitops/root" ||
          environment.id.startsWith("gitops/tofu:") ? (
            <PlatformReleaseForm
              environment={environment}
              overview={data}
              principal={identity.data}
              client={client}
              onDeployment={state.selectDeployment}
              onClose={() => {
                setEnvironmentId(null);
              }}
            />
          ) : (
            <ReleaseForm
              key={environment.id}
              environment={environment}
              overview={data}
              client={client}
              permitted={canDeploy(identity.data)}
              pending={request.isPending}
              onSubmit={(input) => {
                request.mutate(input);
              }}
              onClose={() => {
                setEnvironmentId(null);
              }}
            />
          )}
          <WorkerPoolPanel
            key={`workers:${environment.id}`}
            client={client}
            environment={environment}
            deployments={data.deployments}
            permitted={canDeploy(identity.data)}
            onDeployment={state.selectDeployment}
          />
          <ForumBaselinePanel
            environment={environment}
            intents={data.forumBaselines}
          />
        </>
      )}
      {deploymentId !== null && (
        <>
          {detail.isPending && <p role="status">Loading deployment…</p>}
          {detail.error !== null && <ErrorNotice error={detail.error} />}
          {detail.data !== undefined && (
            <DeploymentDetail
              key={detail.data.deployment.id}
              detail={detail.data}
              principal={identity.data}
              pending={action.isPending}
              onAction={(input) => {
                action.mutate(input);
              }}
              onClose={() => {
                setDeploymentId(null);
              }}
            />
          )}
        </>
      )}
    </>
  );
}
