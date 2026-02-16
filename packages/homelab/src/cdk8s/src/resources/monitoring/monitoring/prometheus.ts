import { PrometheusRule } from "../../../../generated/imports/monitoring.coreos.com";
import type { Chart } from "cdk8s";
import { getHomeAssistantRuleGroups } from "./rules/homeassistant";
import { getVeleroRuleGroups } from "./rules/velero";
import { getArgoCDRuleGroups } from "./rules/argocd";
import { getResourceMonitoringRuleGroups } from "./rules/resource-monitoring";
import { getZfsMonitoringRuleGroups } from "./rules/zfs";
import { getSmartctlRuleGroups } from "./rules/smartctl";
import { getHaWorkflowRuleGroups } from "./rules/ha-workflows";
import { getGitckupRuleGroups } from "./rules/gitckup";
import { getQBitTorrentRuleGroups } from "./rules/qbittorrent";
import { getStaticSitesRuleGroups } from "./rules/static-sites";
import { getR2StorageRuleGroups } from "./rules/r2-storage";
import { getBugsinkRuleGroups } from "./rules/bugsink";
import { getPostalRuleGroups } from "./rules/postal";
import { getScoutRuleGroups } from "./rules/scout";

export function createPrometheusMonitoring(chart: Chart) {
  // Create Home Assistant rules
  new PrometheusRule(chart, "prometheus-homeassistant-rules", {
    metadata: {
      name: "prometheus-homeassistant-rules",
      namespace: "home",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getHomeAssistantRuleGroups(),
    },
  });

  // Create Velero rules
  new PrometheusRule(chart, "prometheus-velero-rules", {
    metadata: {
      name: "prometheus-velero-rules",
      namespace: "velero",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getVeleroRuleGroups(),
    },
  });

  // Create Argo CD rules
  new PrometheusRule(chart, "prometheus-argocd-rules", {
    metadata: {
      name: "prometheus-argocd-rules",
      namespace: "argocd",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getArgoCDRuleGroups(),
    },
  });

  // Create Resource Monitoring rules
  new PrometheusRule(chart, "prometheus-resource-monitoring-rules", {
    metadata: {
      name: "prometheus-resource-monitoring-rules",
      namespace: "prometheus",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getResourceMonitoringRuleGroups(),
    },
  });

  // Create ZFS Monitoring rules
  new PrometheusRule(chart, "prometheus-zfs-monitoring-rules", {
    metadata: {
      name: "prometheus-zfs-monitoring-rules",
      namespace: "prometheus",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getZfsMonitoringRuleGroups(),
    },
  });

  new PrometheusRule(chart, "prometheus-smartctl-rules", {
    metadata: {
      name: "prometheus-smartctl-rules",
      namespace: "prometheus",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getSmartctlRuleGroups(),
    },
  });

  // Create HA Workflow rules
  new PrometheusRule(chart, "prometheus-ha-workflow-rules", {
    metadata: {
      name: "prometheus-ha-workflow-rules",
      namespace: "home",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getHaWorkflowRuleGroups(),
    },
  });

  // Create Gitckup rules
  new PrometheusRule(chart, "prometheus-gitckup-rules", {
    metadata: {
      name: "prometheus-gitckup-rules",
      namespace: "gickup",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getGitckupRuleGroups(),
    },
  });

  // Create qBittorrent rules
  new PrometheusRule(chart, "prometheus-qbittorrent-rules", {
    metadata: {
      name: "prometheus-qbittorrent-rules",
      namespace: "media",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getQBitTorrentRuleGroups(),
    },
  });

  // Create static sites rules
  new PrometheusRule(chart, "prometheus-static-sites-rules", {
    metadata: {
      name: "prometheus-static-sites-rules",
      namespace: "s3-static-sites",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getStaticSitesRuleGroups(),
    },
  });

  // Create R2 storage rules
  new PrometheusRule(chart, "prometheus-r2-storage-rules", {
    metadata: {
      name: "prometheus-r2-storage-rules",
      namespace: "prometheus",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getR2StorageRuleGroups(),
    },
  });

  // Create Bugsink rules
  new PrometheusRule(chart, "prometheus-bugsink-rules", {
    metadata: {
      name: "prometheus-bugsink-rules",
      namespace: "bugsink",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getBugsinkRuleGroups(),
    },
  });

  // Create Postal rules
  new PrometheusRule(chart, "prometheus-postal-rules", {
    metadata: {
      name: "prometheus-postal-rules",
      namespace: "postal",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getPostalRuleGroups(),
    },
  });

  // Create Scout rules
  new PrometheusRule(chart, "prometheus-scout-rules", {
    metadata: {
      name: "prometheus-scout-rules",
      namespace: "prometheus",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getScoutRuleGroups(),
    },
  });
}
