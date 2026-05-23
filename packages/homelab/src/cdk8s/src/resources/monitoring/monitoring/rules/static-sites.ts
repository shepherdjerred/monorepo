import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getStaticSitesRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "static-sites-availability",
      rules: [
        {
          alert: "StaticSiteDown",
          annotations: {
            summary: escapePrometheusTemplate(
              "[{{ $labels.site }}{{ $labels.path }}] Static site endpoint is down",
            ),
            description: escapePrometheusTemplate(
              "Static site endpoint {{ $labels.site }}{{ $labels.path }} ({{ $labels.endpoint }}) has been unreachable for more than 5 minutes. The probe is failing to get a successful HTTP response.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'probe_success{job=~"static-site-.*"} == 0',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "StaticSiteSlowResponse",
          annotations: {
            summary: escapePrometheusTemplate(
              "[{{ $labels.site }}{{ $labels.path }}] Static site endpoint responding slowly",
            ),
            description: escapePrometheusTemplate(
              "Static site endpoint {{ $labels.site }}{{ $labels.path }} ({{ $labels.endpoint }}) is responding slowly (>3s) for more than 10 minutes. Current response time: {{ $value | humanizeDuration }}",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (job, instance, site, endpoint, path) (probe_http_duration_seconds{job=~"static-site-.*", phase=~"resolve|connect|tls|processing|transfer"}) > 3',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "StaticSiteSSLCertExpiringSoon",
          annotations: {
            summary: escapePrometheusTemplate(
              "[{{ $labels.site }}] SSL certificate expiring soon",
            ),
            description: escapePrometheusTemplate(
              "SSL certificate for {{ $labels.site }} will expire in less than 14 days. Days remaining: {{ $value | humanize }}",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(probe_ssl_earliest_cert_expiry{job=~"static-site-.*", endpoint="root"} - time()) / 86400 < 14',
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "StaticSiteSSLCertExpiryCritical",
          annotations: {
            summary: escapePrometheusTemplate(
              "[{{ $labels.site }}] SSL certificate expiring very soon",
            ),
            description: escapePrometheusTemplate(
              "SSL certificate for {{ $labels.site }} will expire in less than 3 days! Days remaining: {{ $value | humanize }}",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(probe_ssl_earliest_cert_expiry{job=~"static-site-.*", endpoint="root"} - time()) / 86400 < 3',
          ),
          for: "1h",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "StaticSiteProbeAbsent",
          annotations: {
            summary: "Static site probes are not running",
            description:
              "No probe_success metrics have been collected for static sites in the last 10 minutes. The blackbox-exporter or probes may be misconfigured.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(probe_success{job=~"static-site-.*"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Suppress when StaticSiteProbeAbsent already fires for a total
          // blackbox outage — that alert is the superset condition and would
          // otherwise double-page on the same root cause.
          alert: "StaticSiteRssProbeAbsent",
          annotations: {
            summary: "sjer.red RSS probe is not running",
            description:
              "No probe_success metrics have been collected for https://sjer.red/rss.xml in the last 10 minutes, but other static-site probes are reporting. The RSS Probe resource or its scrape config is likely the problem.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(probe_success{job="static-site-sjer.red-rss", site="sjer.red", endpoint="rss", path="/rss.xml"}) == 1 unless on() absent(probe_success{job=~"static-site-.*"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
