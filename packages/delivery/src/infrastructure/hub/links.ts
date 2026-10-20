import type { Service } from "@shepherdjerred/ops-model/catalog.ts";
import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  TOOL_HOSTS,
  argocdApplicationLink,
  bugsinkLink,
  githubCommitLink,
  grafanaDashboardLink,
  temporalWorkflowLink,
  woodpeckerPipelineLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import { deliveryWorkflowId } from "#shared/contract.ts";

/** Tools every hub page offers as top-level destinations. */
export function toolLinks(): Link[] {
  return [
    { kind: "github", label: "GitHub monorepo", url: TOOL_HOSTS.github },
    { kind: "woodpecker", label: "Woodpecker CI", url: TOOL_HOSTS.woodpecker },
    { kind: "argocd", label: "Argo CD", url: TOOL_HOSTS.argocd },
    { kind: "temporal", label: "Temporal", url: TOOL_HOSTS.temporal },
    { kind: "grafana", label: "Grafana", url: TOOL_HOSTS.grafana },
    bugsinkLink(),
  ];
}

export function serviceLinks(service: Service): Link[] {
  return [
    ...service.argoApps.map((app) => argocdApplicationLink(app)),
    ...service.grafanaDashboards.map((uid) => grafanaDashboardLink(uid)),
    ...(service.bugsinkProjects.length > 0 ? [bugsinkLink()] : []),
  ];
}

export function buildLinks(build: {
  sourceRevision: string;
  sourceKind: string;
  ciUrl: string | null;
  pipelineNumber: number | null;
}): Link[] {
  const links: Link[] = [];
  if (build.sourceKind === "ci")
    links.push(githubCommitLink(build.sourceRevision));
  if (build.pipelineNumber !== null)
    links.push(woodpeckerPipelineLink(build.pipelineNumber));
  else if (build.ciUrl !== null)
    links.push({ kind: "woodpecker", label: "CI run", url: build.ciUrl });
  return links;
}

export function deploymentLinks(
  deployment: { id: string; status: string },
  application: string | null,
): Link[] {
  return [
    ...(deployment.status === "awaiting_approval"
      ? []
      : [temporalWorkflowLink(deliveryWorkflowId(deployment.id))]),
    ...(application === null ? [] : [argocdApplicationLink(application)]),
  ];
}
