import type { Link } from "./snapshot.ts";

/**
 * Browser-facing tool hosts. These are tailnet or public product URLs, not
 * deployment settings: in-cluster service addresses are unreachable from a
 * browser, so deep links always use these hosts.
 */
export const TOOL_HOSTS = {
  woodpecker: "https://woodpecker.sjer.red",
  github: "https://github.com/shepherdjerred/monorepo",
  argocd: "https://argocd.tailnet-1a49.ts.net",
  grafana: "https://grafana.tailnet-1a49.ts.net",
  temporal: "https://temporal-ui.tailnet-1a49.ts.net",
  bugsink: "https://bugsink.sjer.red",
  chartmuseum: "https://chartmuseum.tailnet-1a49.ts.net",
} as const;

const WOODPECKER_REPOSITORY_ID = 1;
const TEMPORAL_NAMESPACE = "prod";

function url(host: string, path: string) {
  return new URL(path, `${host}/`).toString();
}

export function woodpeckerPipelineLink(pipelineNumber: number): Link {
  return {
    kind: "woodpecker",
    label: `Woodpecker #${String(pipelineNumber)}`,
    url: url(
      TOOL_HOSTS.woodpecker,
      `repos/${String(WOODPECKER_REPOSITORY_ID)}/pipeline/${String(pipelineNumber)}`,
    ),
  };
}

export function woodpeckerStepLink(
  pipelineNumber: number,
  step: { pid: number; name: string },
): Link {
  return {
    kind: "woodpecker",
    label: `Woodpecker step ${step.name}`,
    url: url(
      TOOL_HOSTS.woodpecker,
      `repos/${String(WOODPECKER_REPOSITORY_ID)}/pipeline/${String(pipelineNumber)}/${String(step.pid)}`,
    ),
  };
}

export function githubCommitLink(sha: string): Link {
  return {
    kind: "github",
    label: `GitHub commit ${sha.slice(0, 7)}`,
    url: `${TOOL_HOSTS.github}/commit/${encodeURIComponent(sha)}`,
  };
}

export function githubPullRequestLink(number: number): Link {
  return {
    kind: "github",
    label: `GitHub PR #${String(number)}`,
    url: `${TOOL_HOSTS.github}/pull/${String(number)}`,
  };
}

export function argocdApplicationLink(application: string): Link {
  return {
    kind: "argocd",
    label: `Argo CD ${application}`,
    url: url(
      TOOL_HOSTS.argocd,
      `applications/argocd/${encodeURIComponent(application)}`,
    ),
  };
}

export function grafanaDashboardLink(uid: string): Link {
  return {
    kind: "grafana",
    label: `Grafana ${uid}`,
    url: url(TOOL_HOSTS.grafana, `d/${encodeURIComponent(uid)}`),
  };
}

export function temporalWorkflowLink(workflowId: string): Link {
  return {
    kind: "temporal",
    label: "Temporal workflow",
    url: url(
      TOOL_HOSTS.temporal,
      `namespaces/${TEMPORAL_NAMESPACE}/workflows/${encodeURIComponent(workflowId)}`,
    ),
  };
}

export function bugsinkLink(): Link {
  return {
    kind: "bugsink",
    label: "Bugsink",
    url: url(TOOL_HOSTS.bugsink, ""),
  };
}

/** Chartmuseum chart-version metadata for a chart published there. */
export function chartmuseumChartLink(name: string, version: string): Link {
  return {
    kind: "registry",
    label: `Chart ${name} ${version}`,
    url: url(
      TOOL_HOSTS.chartmuseum,
      `api/charts/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    ),
  };
}
