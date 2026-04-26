import type { Chart } from "cdk8s";
import { ConfigMap } from "cdk8s-plus-31";
import { exportGitckupDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/gitckup-dashboard.ts";
import { exportHaWorkflowDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/ha-workflow-dashboard.ts";
import { exportScoutDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/scout-dashboard.ts";
import { exportSmartctlDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/smartctl-dashboard.ts";
import { exportVeleroDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/velero-dashboard.ts";
import { exportTasknotesDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/tasknotes-dashboard.ts";
import { exportBuildkiteDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/buildkite-dashboard.ts";
import { exportZfsDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/zfs-dashboard.ts";
import { exportTemporalDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/temporal-dashboard.ts";

/**
 * Dashboard configuration for creating Grafana dashboard ConfigMaps
 */
type DashboardConfig = {
  /** Unique ID for the CDK8s resource */
  id: string;
  /** ConfigMap name in Kubernetes */
  name: string;
  /** JSON filename for the dashboard */
  jsonFilename: string;
  /** Function that exports the dashboard JSON */
  exportFn: () => string;
};

/**
 * Generic function to create a Kubernetes ConfigMap for a Grafana dashboard
 * The ConfigMap will be automatically discovered by Grafana's sidecar container
 * and provisioned into Grafana
 */
function createDashboardConfigMap(chart: Chart, config: DashboardConfig) {
  const dashboardJson = config.exportFn();

  new ConfigMap(chart, config.id, {
    metadata: {
      name: config.name,
      namespace: "prometheus",
      labels: {
        // Required labels for Grafana sidecar discovery
        grafana_dashboard: "1",
        app: "grafana",
      },
    },
    data: {
      [config.jsonFilename]: dashboardJson,
    },
  });
}

/**
 * All available Grafana dashboards
 */
const GITCKUP_DASHBOARD: DashboardConfig = {
  id: "gitckup-dashboard-configmap",
  name: "gitckup-dashboard",
  jsonFilename: "gitckup.json",
  exportFn: exportGitckupDashboardJson,
};

const HA_WORKFLOW_DASHBOARD: DashboardConfig = {
  id: "ha-workflow-dashboard-configmap",
  name: "ha-workflow-dashboard",
  jsonFilename: "ha-workflow.json",
  exportFn: exportHaWorkflowDashboardJson,
};

const SCOUT_DASHBOARD: DashboardConfig = {
  id: "scout-dashboard-configmap",
  name: "scout-for-lol-dashboard",
  jsonFilename: "scout-for-lol.json",
  exportFn: exportScoutDashboardJson,
};

const SMARTCTL_DASHBOARD: DashboardConfig = {
  id: "smartctl-dashboard-configmap",
  name: "smartctl-dashboard",
  jsonFilename: "smartctl.json",
  exportFn: exportSmartctlDashboardJson,
};

const VELERO_DASHBOARD: DashboardConfig = {
  id: "velero-dashboard-configmap",
  name: "velero-dashboard",
  jsonFilename: "velero.json",
  exportFn: exportVeleroDashboardJson,
};

const TASKNOTES_DASHBOARD: DashboardConfig = {
  id: "tasknotes-dashboard-configmap",
  name: "tasknotes-dashboard",
  jsonFilename: "tasknotes.json",
  exportFn: exportTasknotesDashboardJson,
};

const ZFS_DASHBOARD: DashboardConfig = {
  id: "zfs-dashboard-configmap",
  name: "zfs-dashboard",
  jsonFilename: "zfs.json",
  exportFn: exportZfsDashboardJson,
};

const BUILDKITE_DASHBOARD: DashboardConfig = {
  id: "buildkite-dashboard-configmap",
  name: "buildkite-dashboard",
  jsonFilename: "buildkite.json",
  exportFn: exportBuildkiteDashboardJson,
};

const TEMPORAL_DASHBOARD: DashboardConfig = {
  id: "temporal-dashboard-configmap",
  name: "temporal-dashboard",
  jsonFilename: "temporal.json",
  exportFn: exportTemporalDashboardJson,
};

const ALL_DASHBOARDS: DashboardConfig[] = [
  BUILDKITE_DASHBOARD,
  GITCKUP_DASHBOARD,
  HA_WORKFLOW_DASHBOARD,
  SCOUT_DASHBOARD,
  SMARTCTL_DASHBOARD,
  TASKNOTES_DASHBOARD,
  TEMPORAL_DASHBOARD,
  VELERO_DASHBOARD,
  ZFS_DASHBOARD,
];

/**
 * Creates all Grafana dashboard ConfigMaps
 * Call this function once to provision all dashboards
 */
export function createAllGrafanaDashboards(chart: Chart) {
  ALL_DASHBOARDS.forEach((dashboard) => {
    createDashboardConfigMap(chart, dashboard);
  });
}
