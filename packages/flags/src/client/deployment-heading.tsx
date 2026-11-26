import type { ReactNode } from "react";
import { GitCompareArrowsIcon } from "lucide-react";
import { PageHeading, Tag } from "@shepherdjerred/console-ui";
import { useDeployments } from "./api.ts";
import { LinkButton } from "./link-button.tsx";
import { stageLabel, splitDeploymentId } from "./model.ts";
import { comparePath, pairedStage } from "./views/compare-model.ts";
import { DriftChip } from "./views/drift-chip.tsx";
import { deploymentCounts, itemCount } from "./views/drift-model.ts";
import { useDrift } from "./views/views-api.ts";

/**
 * A deployment's opening: the catalog as eyebrow and the stage as title, with
 * its revision, drift and a link to compare it with its other stage.
 */
export function DeploymentHeading({
  catalog,
  stage,
  meta,
}: {
  readonly catalog: string;
  readonly stage: string;
  readonly meta?: ReactNode;
}): React.JSX.Element {
  const id = `${catalog}/${stage}`;
  const deployments = useDeployments();
  const drift = useDrift();
  const ids = deployments.data?.map((deployment) => deployment.id) ?? [];
  const partner = pairedStage(ids, id);
  const entry = drift.data?.deployments.find(
    (deployment) => deployment.id === id,
  );
  const drifted = entry !== undefined && itemCount(deploymentCounts(entry)) > 0;
  return (
    <PageHeading
      eyebrow={catalog}
      title={stageLabel(stage)}
      actions={
        <>
          {meta === undefined ? null : (
            <Tag className="fl-revision">{meta}</Tag>
          )}
          {drifted ? <DriftChip entry={entry} /> : null}
          {partner === undefined ? null : (
            <LinkButton
              to={
                stage === "beta"
                  ? comparePath(id, partner)
                  : comparePath(partner, id)
              }
            >
              <GitCompareArrowsIcon aria-hidden="true" />
              Compare with {stageLabel(splitDeploymentId(partner).stage)}
            </LinkButton>
          )}
        </>
      }
    />
  );
}
