import type { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getQBitTorrentRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "qbittorrent.rules",
      interval: "30s",
      rules: [
        {
          alert: "QBitTorrentFirewalled",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("qbittorrent_firewalled == 1"),
          for: "5m",
          labels: {
            severity: "warning",
            category: "network",
          },
          annotations: {
            summary: "qBittorrent is firewalled",
            description: escapePrometheusTemplate(
              "qBittorrent instance is currently firewalled and cannot accept incoming connections. This may impact download speeds and connectivity.",
            ),
          },
        },
      ],
    },
  ];
}
