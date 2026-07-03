import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getQBitTorrentRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "qbittorrent.rules",
      interval: "30s",
      rules: [
        {
          alert: "QBitTorrentFirewalled",
          // Gated on the client having at least one torrent. qBittorrent only
          // flips its "firewalled" status to healthy once it RECEIVES an
          // incoming peer connection — with zero torrents loaded, nothing ever
          // drives an inbound connection, so the status stays stuck at
          // firewalled even when the forwarded port is genuinely open and
          // reachable. That produced a false page every time the pod restarted
          // into an idle/empty client. `and on(server)` keeps the firewalled
          // series only when the summed torrent count for that same server is
          // > 0. Both metrics carry the `server` label from the exporter.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "qbittorrent_firewalled == 1 and on(server) (sum by (server) (qbittorrent_torrents_count)) > 0",
          ),
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
