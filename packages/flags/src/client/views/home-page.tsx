import {
  Card,
  PageBody,
  PageHeading,
  SummaryGrid,
  type SummaryItem,
} from "@shepherdjerred/console-ui";
import { GitCompareArrowsIcon, RadarIcon } from "lucide-react";
import { Link } from "react-router";
import { useDeployments } from "@shepherdjerred/flags/client/api.ts";
import { LinkButton } from "@shepherdjerred/flags/client/link-button.tsx";
import {
  deploymentPath,
  splitDeploymentId,
  stageLabel,
} from "@shepherdjerred/flags/client/model.ts";
import { deploymentIcon } from "@shepherdjerred/flags/client/nav.ts";
import { comparePath, pairedStage } from "./compare-model.ts";
import {
  deploymentCounts,
  driftSeverity,
  itemCount,
  totalCounts,
  type DeploymentDrift,
} from "./drift-model.ts";
import { DriftChip } from "./drift-chip.tsx";
import { FetchLiveness } from "./usage-panel.tsx";
import { useDrift } from "./views-api.ts";

type Summary = {
  readonly id: string;
  readonly revision: number;
  readonly flagCount: number;
};

function CatalogCard({
  catalog,
  deployments,
  ids,
  drift,
}: {
  readonly catalog: string;
  readonly deployments: readonly Summary[];
  readonly ids: readonly string[];
  readonly drift: ReadonlyMap<string, DeploymentDrift> | undefined;
}): React.JSX.Element {
  const headingId = `catalog-${catalog}`;
  const beta = deployments.find(
    (deployment) =>
      splitDeploymentId(deployment.id).stage === "beta" &&
      pairedStage(ids, deployment.id) !== undefined,
  );
  const partner = beta === undefined ? undefined : pairedStage(ids, beta.id);
  return (
    <li>
      <Card className="fl-card">
        <h3 className="fl-card-title" id={headingId}>
          {catalog}
        </h3>
        <ul className="fl-card-rows" aria-labelledby={headingId}>
          {deployments.map((deployment) => {
            const { stage } = splitDeploymentId(deployment.id);
            const Icon = deploymentIcon(stage);
            return (
              <li key={deployment.id} className="fl-card-row">
                <Link
                  className="fl-card-link"
                  to={deploymentPath(catalog, stage)}
                >
                  <Icon aria-hidden="true" />
                  <span>{stageLabel(stage)}</span>
                </Link>
                <span className="fl-card-meta">
                  {deployment.flagCount} flags · r{deployment.revision}
                </span>
                <DriftChip entry={drift?.get(deployment.id)} />
                <FetchLiveness
                  deployment={deployment.id}
                  className="fl-card-live"
                />
              </li>
            );
          })}
        </ul>
        {beta === undefined || partner === undefined ? null : (
          <Link className="fl-card-foot" to={comparePath(beta.id, partner)}>
            <GitCompareArrowsIcon aria-hidden="true" />
            Compare {stageLabel(splitDeploymentId(beta.id).stage)} and{" "}
            {stageLabel(splitDeploymentId(partner).stage)}
          </Link>
        )}
      </Card>
    </li>
  );
}

/** The landing page: totals, then one card per catalog with its stages. */
export function HomePage(): React.JSX.Element {
  const deployments = useDeployments();
  const drift = useDrift();
  const list = deployments.data ?? [];
  const ids = list.map((deployment) => deployment.id);
  const flagTotal = list.reduce((sum, entry) => sum + entry.flagCount, 0);
  const byCatalog = new Map<string, Summary[]>();
  for (const deployment of list.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const { catalog } = splitDeploymentId(deployment.id);
    byCatalog.set(catalog, [...(byCatalog.get(catalog) ?? []), deployment]);
  }
  const driftById =
    drift.data === undefined
      ? undefined
      : new Map(drift.data.deployments.map((entry) => [entry.id, entry]));
  const drifted =
    drift.data?.deployments.filter(
      (entry) => itemCount(deploymentCounts(entry)) > 0,
    ) ?? [];
  const totals: SummaryItem[] = [
    { label: "Deployments", value: list.length },
    { label: "Flags", value: flagTotal },
    drift.data === undefined
      ? { label: "Drifted deployments", value: "—" }
      : {
          label: "Drifted deployments",
          value: drifted.length,
          severity: driftSeverity(totalCounts(drift.data.deployments)),
        },
  ];
  return (
    <PageBody>
      <PageHeading
        eyebrow="Flags"
        title="Deployments"
        description="Live flag documents for every first-party deployment."
        actions={
          <>
            <LinkButton to="/compare">
              <GitCompareArrowsIcon aria-hidden="true" />
              Compare
            </LinkButton>
            <LinkButton to="/drift">
              <RadarIcon aria-hidden="true" />
              Drift
            </LinkButton>
          </>
        }
      />
      {deployments.isPending ? (
        <p className="ui-state" role="status">
          Loading deployments…
        </p>
      ) : deployments.isError ? (
        <p className="ui-state" role="alert">
          {deployments.error.message}
        </p>
      ) : (
        <>
          <SummaryGrid label="Totals" items={totals} />
          <h2 className="ui-block-head">Catalogs</h2>
          <ul className="fl-cards">
            {[...byCatalog.entries()].map(([catalog, entries]) => (
              <CatalogCard
                key={catalog}
                catalog={catalog}
                deployments={entries}
                ids={ids}
                drift={driftById}
              />
            ))}
          </ul>
        </>
      )}
    </PageBody>
  );
}
